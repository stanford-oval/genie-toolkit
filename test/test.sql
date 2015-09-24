-- sql does not do newlines, so this looks bad
-- sorry

-- (also, don't put comments in db/schema.sql!
-- this file is only fed into the sqlite3 command, but schema.sql
-- also goes into nodejs-sqlite3 and that does not support comments)

-- FIXME: this needs redoing

insert or replace into app (uniqueId, tier, code, state) values
       ('test-2aedfd34-5cf7-4bc5-9ab7-0853037aff12',
        'phone',
        '@name "Test"; @description "A test application"; :test as test {} => :logger { message: "Test App received an event on Test Channel"; }',
        '{}'),
       ('brannigan-pipe-source-006dc6c3-e314-4332-816e-61d49b4601d8',
        'server',
        ':test as test { number >= 63; } => :pipe-mypipe { something: test.number - 42; }',
        '{}'),
       ('branningan-test-1a02bef5-23ab-4fee-bb58-af968d4c64e1',
        'server',
        ':test as in { number = 42; } => :test { text: in.number " is my lucky number!"; }',
        '{}'),
       ('branningan-pipe-sink-test-ba4c164f-511e-4855-b7d6-db29472d01a1',
        'server',
        ':pipe-mypipe as in {} => :test { text: in.something " was piped through!"; }',
        '{}')
;

insert or replace into app_journal (uniqueId, lastModified) values
       ('test-2aedfd34-5cf7-4bc5-9ab7-0853037aff12', 1441420637000),
       ('brannigan-pipe-source-006dc6c3-e314-4332-816e-61d49b4601d8',
        1441420637000),
       ('branningan-test-1a02bef5-23ab-4fee-bb58-af968d4c64e1',
        1441420637000),
       ('branningan-pipe-sink-test-ba4c164f-511e-4855-b7d6-db29472d01a1',
        1441420637000),
        -- look ma, no corresponding row in app!
        -- this journal entry logs a deletion, and it's here to test how we behave
       ('appdb-test-214d8303-d078-4b92-a7ea-fcaed6f53e6a',
        1441420637000)
;
