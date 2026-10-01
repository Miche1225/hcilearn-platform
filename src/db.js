// src/db.js

const { Pool } = require('pg');
const { hashEmail } = require('./utils/emailSecurity');


/*
    Make sure DATABASE_URL exists.
*/
if (!process.env.DATABASE_URL) {

    console.error(
        'Missing DATABASE_URL environment variable. Set it to your PostgreSQL connection string.'
    );
}


/*
    PostgreSQL connection.
*/
const pool =
    new Pool({

        connectionString:
            process.env.DATABASE_URL,

        ssl:
            process.env.DATABASE_URL &&
            process.env.DATABASE_URL.includes('localhost')
                ? false
                : {
                    rejectUnauthorized: false
                }

    });


/*
    Initialize and migrate the database.

    IMPORTANT:
    Older versions of the project stored plaintext email in users.email.
    This migration:

    1. Creates email_hash when needed.
    2. Converts existing plaintext emails to HMAC hashes.
    3. Verifies every user has an email_hash.
    4. Makes email_hash required and unique.
    5. Removes the plaintext email column.
*/
async function init() {

    /* ==============================================
       CREATE CORE TABLES
       ============================================== */

    await pool.query(`

        CREATE TABLE IF NOT EXISTS users (

            id
                SERIAL
                PRIMARY KEY,

            full_name
                TEXT
                NOT NULL,

            first_name
                TEXT,

            last_name
                TEXT,

            year_section
                TEXT,

            program
                TEXT,

            email_hash
                TEXT,

            student_id
                TEXT,

            password_hash
                TEXT
                NOT NULL,

            profile_photo
                TEXT,

            created_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW()
        );


        CREATE TABLE IF NOT EXISTS case_study_progress (

            user_id
                INTEGER
                PRIMARY KEY
                REFERENCES users(id)
                ON DELETE CASCADE,

            unlocked_level
                INTEGER
                NOT NULL
                DEFAULT 1,

            solved_ids
                TEXT
                NOT NULL
                DEFAULT '[]'
        );


        CREATE TABLE IF NOT EXISTS study_card_progress (

            user_id
                INTEGER
                PRIMARY KEY
                REFERENCES users(id)
                ON DELETE CASCADE,

            unlocked_lesson
                INTEGER
                NOT NULL
                DEFAULT 1,

            completed_ids
                TEXT
                NOT NULL
                DEFAULT '[]'
        );


        CREATE TABLE IF NOT EXISTS lesson_progress (

            user_id
                INTEGER
                PRIMARY KEY
                REFERENCES users(id)
                ON DELETE CASCADE,

            completed
                INTEGER
                NOT NULL
                DEFAULT 0,

            completed_at
                TIMESTAMPTZ
        );


        CREATE TABLE IF NOT EXISTS video_progress (

            user_id
                INTEGER
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            video_id
                TEXT
                NOT NULL,

            title
                TEXT,

            watched_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW(),

            PRIMARY KEY (
                user_id,
                video_id
            )
        );


        CREATE TABLE IF NOT EXISTS password_resets (

            id
                SERIAL
                PRIMARY KEY,

            user_id
                INTEGER
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            token_hash
                TEXT
                NOT NULL
                UNIQUE,

            expires_at
                TIMESTAMPTZ
                NOT NULL,

            created_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW()
        );


        CREATE TABLE IF NOT EXISTS activity_log (

            id
                SERIAL
                PRIMARY KEY,

            user_id
                INTEGER
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            type
                TEXT
                NOT NULL,

            description
                TEXT
                NOT NULL,

            created_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW()
        );

    `);


    /* ==============================================
       START MIGRATION TRANSACTION
       ============================================== */

    const client =
        await pool.connect();


    try {

        await client.query('BEGIN');


        /* ----------------------------------------------
           Ensure columns exist for older databases.
           ---------------------------------------------- */

        await client.query(
            'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name TEXT'
        );

        await client.query(
            'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name TEXT'
        );

        await client.query(
            'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_hash TEXT'
        );


        /* ----------------------------------------------
           Backfill first_name / last_name.
           ---------------------------------------------- */

        const legacyNames =
            await client.query(`

                SELECT
                    id,
                    full_name

                FROM public.users

                WHERE
                    first_name IS NULL
                    OR
                    last_name IS NULL

            `);


        for (
            const row
            of legacyNames.rows
        ) {

            const parts =
                String(
                    row.full_name || ''
                )
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean);


            const firstName =
                parts.shift() || '';


            const lastName =
                parts.join(' ') || '';


            await client.query(

                `UPDATE public.users

                 SET
                    first_name = COALESCE(first_name, $1),
                    last_name = COALESCE(last_name, $2)

                 WHERE id = $3`,

                [
                    firstName,
                    lastName,
                    row.id
                ]
            );
        }


        /* ----------------------------------------------
           Detect whether the old plaintext email column
           still exists.
           ---------------------------------------------- */

        const emailColumnResult =
            await client.query(`

                SELECT EXISTS (

                    SELECT 1

                    FROM information_schema.columns

                    WHERE
                        table_schema = 'public'
                        AND table_name = 'users'
                        AND column_name = 'email'

                ) AS exists

            `);


        const hasLegacyEmailColumn =
            emailColumnResult.rows[0].exists === true;


        /* ----------------------------------------------
           Backfill email_hash from the old plaintext
           email column before removing that column.
           ---------------------------------------------- */

        if (hasLegacyEmailColumn) {

            const missingEmailHashes =
                await client.query(`

                    SELECT
                        id,
                        email

                    FROM public.users

                    WHERE
                        (email_hash IS NULL OR BTRIM(email_hash) = '')
                        AND email IS NOT NULL
                        AND BTRIM(email) <> ''

                `);


            for (
                const row
                of missingEmailHashes.rows
            ) {

                await client.query(

                    `UPDATE public.users

                     SET email_hash = $1

                     WHERE id = $2`,

                    [
                        hashEmail(row.email),
                        row.id
                    ]
                );
            }
        }


        /* ----------------------------------------------
           Make sure no user is missing the hash.
           ---------------------------------------------- */

        const missingCountResult =
            await client.query(`

                SELECT COUNT(*)::integer AS count

                FROM public.users

                WHERE
                    email_hash IS NULL
                    OR BTRIM(email_hash) = ''

            `);


        const missingCount =
            missingCountResult.rows[0].count;


        if (missingCount > 0) {

            throw new Error(
                `Cannot finish email security migration: ${missingCount} user(s) do not have an email_hash.`
            );
        }


        /* ----------------------------------------------
           Make email_hash unique.
           ---------------------------------------------- */

        await client.query(`

            CREATE UNIQUE INDEX IF NOT EXISTS
            users_email_hash_unique

            ON public.users(email_hash)

        `);


        /* ----------------------------------------------
           Make email_hash required.
           ---------------------------------------------- */

        await client.query(`

            ALTER TABLE public.users
            ALTER COLUMN email_hash SET NOT NULL

        `);


        /* ----------------------------------------------
           Remove plaintext email only after every user's
           email_hash has been verified.
           ---------------------------------------------- */

        if (hasLegacyEmailColumn) {

            await client.query(`

                ALTER TABLE public.users
                DROP COLUMN IF EXISTS email

            `);
        }


        await client.query('COMMIT');

    } catch (err) {

        await client.query('ROLLBACK');

        throw err;

    } finally {

        client.release();
    }
}


/*
    Initialize the database when the server starts.
*/
const ready =
    init().catch(
        (err) => {

            console.error(
                'Failed to initialize database schema:',
                err
            );

            process.exit(1);
        }
    );


module.exports = {
    pool,
    ready
};