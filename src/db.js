// src/db.js

/*
    Connects to a hosted Postgres database.

    Works with services such as:

    - Supabase
    - Neon
    - Other PostgreSQL providers
*/

const {
    Pool
} = require('pg');


/*
    Make sure DATABASE_URL exists.
*/
if (!process.env.DATABASE_URL) {

    console.error(
        'Missing DATABASE_URL environment variable. Set it to your Supabase/Neon connection string.'
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
            process.env.DATABASE_URL.includes(
                'localhost'
            )

                ? false

                : {
                    rejectUnauthorized: false
                }

    });


/*
    Initialize database.
*/
async function init() {

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

            email
                TEXT
                NOT NULL
                UNIQUE,

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


        /*
            Case study progress.
        */
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


        /*
            Study card progress.
        */
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


        /*
            Lesson progress.
        */
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


        /*
            Video progress.
        */
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


        /*
            Password reset tokens.

            Only the SHA-256 hash of the
            token is stored.
        */
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


        /*
            Recent activity log.
        */
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


    /*
        ---------------------------------------------------
        MIGRATIONS
        ---------------------------------------------------

        These are for users who already have
        an older database.
    */


    /*
        Add first_name if it doesn't exist.
    */
    await pool.query(
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT'
    );


    /*
        Add last_name if it doesn't exist.
    */
    await pool.query(
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT'
    );


    /*
        Add email_hash if it doesn't exist.
    */
    await pool.query(
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hash TEXT'
    );


    /*
        ---------------------------------------------------
        BACKFILL FIRST / LAST NAME
        ---------------------------------------------------

        Existing users may only have full_name.

        Example:

        "Juan Dela Cruz"

        becomes:

        first_name = "Juan"
        last_name  = "Dela Cruz"
    */
    const legacyNames =
        await pool.query(

            `SELECT
                id,
                full_name

             FROM users

             WHERE
                first_name IS NULL
                OR
                last_name IS NULL`
        );


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


        await pool.query(

            `UPDATE users

             SET

                first_name =
                    COALESCE(
                        first_name,
                        $1
                    ),

                last_name =
                    COALESCE(
                        last_name,
                        $2
                    )

             WHERE id = $3`,

            [
                firstName,
                lastName,
                row.id
            ]
        );
    }


    /*
        ---------------------------------------------------
        BACKFILL EMAIL HASH
        ---------------------------------------------------
    */
    const {
        hashEmail
    } = require(
        './utils/emailSecurity'
    );


    const missingEmailHashes =
        await pool.query(

            `SELECT
                id,
                email

             FROM users

             WHERE email_hash IS NULL`
        );


    for (
        const row
        of missingEmailHashes.rows
    ) {

        await pool.query(

            `UPDATE users

             SET email_hash = $1

             WHERE id = $2`,

            [
                hashEmail(
                    row.email
                ),

                row.id
            ]
        );
    }


    /*
        Unique email hash index.
    */
    await pool.query(

        `CREATE UNIQUE INDEX IF NOT EXISTS
         users_email_hash_unique

         ON users(email_hash)

         WHERE email_hash IS NOT NULL`
    );
}


/*
    Initialize database when server starts.
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