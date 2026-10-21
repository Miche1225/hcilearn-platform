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


        /* Where the user stopped in each video ("Resume where you left off"). */
        CREATE TABLE IF NOT EXISTS video_positions (

            user_id
                INTEGER
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            video_id
                TEXT
                NOT NULL,

            position_seconds
                INTEGER
                NOT NULL,

            duration_seconds
                INTEGER
                NOT NULL,

            updated_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW(),

            PRIMARY KEY (
                user_id,
                video_id
            )
        );


        /* Questions answered wrong, for "Review my mistakes".
           source = 'case_study' (item_key "12") or 'study_card' (item_key "3-7"). */
        CREATE TABLE IF NOT EXISTS mistakes (

            user_id
                INTEGER
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            source
                TEXT
                NOT NULL,

            item_key
                TEXT
                NOT NULL,

            wrong_count
                INTEGER
                NOT NULL
                DEFAULT 1,

            last_wrong_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW(),

            PRIMARY KEY (
                user_id,
                source,
                item_key
            )
        );


        /* Saved lesson topics / videos with an optional personal note. */
        CREATE TABLE IF NOT EXISTS bookmarks (

            id
                SERIAL
                PRIMARY KEY,

            user_id
                INTEGER
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            kind
                TEXT
                NOT NULL,

            item_key
                TEXT
                NOT NULL,

            title
                TEXT
                NOT NULL,

            note
                TEXT
                NOT NULL
                DEFAULT '',

            created_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW(),

            updated_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW(),

            UNIQUE (
                user_id,
                kind,
                item_key
            )
        );


        /* What each user did per day (Philippine time), for the study
           streak, the daily goal and some badges. */
        CREATE TABLE IF NOT EXISTS daily_activity (

            user_id
                INTEGER
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            day
                DATE
                NOT NULL,

            answers
                INTEGER
                NOT NULL
                DEFAULT 0,

            correct
                INTEGER
                NOT NULL
                DEFAULT 0,

            videos
                INTEGER
                NOT NULL
                DEFAULT 0,

            topics_read
                INTEGER
                NOT NULL
                DEFAULT 0,

            mistakes_cleared
                INTEGER
                NOT NULL
                DEFAULT 0,

            goal_met
                BOOLEAN
                NOT NULL
                DEFAULT FALSE,

            PRIMARY KEY (
                user_id,
                day
            )
        );


        /* Instructor accounts for the Admin Dashboard. Separate from
           student accounts; created with "npm run instructor -- add". */
        CREATE TABLE IF NOT EXISTS instructors (

            id
                SERIAL
                PRIMARY KEY,

            instructor_id
                TEXT
                NOT NULL
                UNIQUE,

            full_name
                TEXT
                NOT NULL,

            password_hash
                TEXT
                NOT NULL,

            session_version
                INTEGER
                NOT NULL
                DEFAULT 0,

            created_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW(),

            last_login_at
                TIMESTAMPTZ
        );


        /* What instructors did on the Admin Dashboard (viewed a student,
           exported data...), for accountability. */
        CREATE TABLE IF NOT EXISTS instructor_audit_log (

            id
                SERIAL
                PRIMARY KEY,

            instructor_id
                INTEGER
                REFERENCES instructors(id)
                ON DELETE SET NULL,

            action
                TEXT
                NOT NULL,

            target_user_id
                INTEGER
                REFERENCES users(id)
                ON DELETE SET NULL,

            details
                TEXT
                NOT NULL
                DEFAULT '',

            created_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW()
        );


        /* Course content edited from the Admin Dashboard.
           "draft" is what instructors edit, "published" is what students
           see; Publish copies draft -> published. NULL draft = deleted in
           the draft, NULL published = not live. Rows are never removed once
           published, so a key is never reused by different content.
           kind: video | module | topic | case | deck | card
           key:  permanent id used by progress, mistakes and bookmarks
                 (e.g. case "12", card "3-7", topic "46", video = YouTube id) */
        CREATE TABLE IF NOT EXISTS content_items (

            id
                SERIAL
                PRIMARY KEY,

            kind
                TEXT
                NOT NULL,

            key
                TEXT
                NOT NULL,

            parent_key
                TEXT,

            draft
                JSONB,

            published
                JSONB,

            updated_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW(),

            UNIQUE (
                kind,
                key
            )
        );


        /* A snapshot of the published content after every publish or
           rollback, so instructors can go back to an earlier version.
           snapshot = [{ kind, key, parentKey, data }, ...] */
        CREATE TABLE IF NOT EXISTS content_versions (

            id
                SERIAL
                PRIMARY KEY,

            instructor_id
                INTEGER
                REFERENCES instructors(id)
                ON DELETE SET NULL,

            summary
                TEXT
                NOT NULL
                DEFAULT '',

            snapshot
                JSONB
                NOT NULL,

            item_count
                INTEGER
                NOT NULL
                DEFAULT 0,

            created_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW()
        );


        /* Which student sections each (non-admin) instructor can see.
           A section = program + year_section, exactly as students entered it. */
        CREATE TABLE IF NOT EXISTS instructor_sections (

            instructor_id
                INTEGER
                NOT NULL
                REFERENCES instructors(id)
                ON DELETE CASCADE,

            program
                TEXT
                NOT NULL,

            year_section
                TEXT
                NOT NULL,

            PRIMARY KEY (
                instructor_id,
                program,
                year_section
            )
        );


        /* Messages from instructors shown on every student's Dashboard. */
        CREATE TABLE IF NOT EXISTS announcements (

            id
                SERIAL
                PRIMARY KEY,

            instructor_id
                INTEGER
                REFERENCES instructors(id)
                ON DELETE SET NULL,

            title
                TEXT
                NOT NULL,

            body
                TEXT
                NOT NULL
                DEFAULT '',

            ends_on
                DATE,

            created_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW()
        );


        /* Badges a user has earned. */
        CREATE TABLE IF NOT EXISTS user_badges (

            user_id
                INTEGER
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            badge_id
                TEXT
                NOT NULL,

            earned_at
                TIMESTAMPTZ
                NOT NULL
                DEFAULT NOW(),

            PRIMARY KEY (
                user_id,
                badge_id
            )
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

        /*
            Session version: stored inside each login cookie.
            Bumping it (password change/reset) logs out every
            other device that still has an old cookie.
        */
        await client.query(
            'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0'
        );

        /* Daily goal: how many questions the user wants to answer per day. */
        await client.query(
            'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS daily_goal INTEGER NOT NULL DEFAULT 10'
        );

        /* Set by an instructor to block an account from logging in. */
        await client.query(
            'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ'
        );

        /* Badges: longest run of correct answers in a row (per day) and
           decks finished without a single mistake. */
        await client.query(
            'ALTER TABLE public.daily_activity ADD COLUMN IF NOT EXISTS best_combo INTEGER NOT NULL DEFAULT 0'
        );
        await client.query(
            'ALTER TABLE public.daily_activity ADD COLUMN IF NOT EXISTS perfect_decks INTEGER NOT NULL DEFAULT 0'
        );

        /* When the student last opened their notifications (announcements
           posted after this are "unread"). */
        await client.query(
            'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS announcements_seen_at TIMESTAMPTZ'
        );

        /* Instructor role: 'admin' (sees and manages everything) or
           'instructor' (sees only their assigned sections). */
        await client.query(
            "ALTER TABLE public.instructors ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'instructor'"
        );

        /* There must always be an admin: the first instructor becomes one. */
        await client.query(`
            UPDATE public.instructors SET role = 'admin'
            WHERE id = (SELECT MIN(id) FROM public.instructors)
              AND NOT EXISTS (SELECT 1 FROM public.instructors WHERE role = 'admin')
        `);

        /* Announcement audience: NULL = everyone, otherwise a list of
           { program, yearSection } sections. */
        await client.query(
            'ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS target_sections JSONB'
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

        await seedContent();

    } catch (err) {

        await client.query('ROLLBACK');

        throw err;

    } finally {

        client.release();
    }
}


/*
    First start only: load the original course content (src/seed/content.json)
    into content_items, published. After that, content is edited from the
    Admin Dashboard and this does nothing.
*/
async function seedContent() {

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM content_items');

    if (rows[0].n > 0) return;

    const seed = require('./seed/content.json');
    const groups = [
        ['module', seed.modules],
        ['topic', seed.topics],
        ['video', seed.videos],
        ['case', seed.cases],
        ['deck', seed.decks],
        ['card', seed.cards],
    ];

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        for (const [kind, items] of groups) {
            for (const item of items) {
                const data = JSON.stringify(item.data);
                await client.query(
                    `INSERT INTO content_items (kind, key, parent_key, draft, published)
                     VALUES ($1, $2, $3, $4::jsonb, $4::jsonb)
                     ON CONFLICT (kind, key) DO NOTHING`,
                    [kind, item.key, item.parentKey || null, data]
                );
            }
        }

        await client.query('COMMIT');
        console.log('Loaded the original course content into content_items.');

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