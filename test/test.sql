-- sql does not do newlines, so this looks bad
-- sorry

-- (also, don't put comments in db/schema.sql!
-- this file is only fed into the sqlite3 command, but schema.sql
-- also goes into nodejs-sqlite3 and that does not support comments)

insert into app (uniqueId, tier, state) values
       ('test-2aedfd34-5cf7-4bc5-9ab7-0853037aff12',
        'phone',
        '{"kind":"test"}'),
       ('brannigan-pipe-source-006dc6c3-e314-4332-816e-61d49b4601d8',
        'phone',
        '{"kind":"brannigan","name":"brannigan pipe source test","trigger":{"channel":{"id":"test"},"filter":[["number",">=",63]]},"action":{"channel":{"id":"pipe-mypipe"},"output":[["something","number","{{number}}-42"]]}}'),
       ('branningan-test-656a9372-68f9-425e-a717-c504d587ea76',
        'server',
        '{"kind":"brannigan","name":"brannigan test 1","trigger":{"channel":{"id":"test"},"filter":[["number",">",63]]},"action":{"channel":{"id":"test"},"output":[["number","number","7*{{number}}"],["text","const","Large"]]}}'),
       ('branningan-test-1a02bef5-23ab-4fee-bb58-af968d4c64e1',
        'server',
        '{"kind": "brannigan","name":"brannigan test 2","trigger":{"channel":{"id":"test"},"filter":[["number","==",42]]},"action":{"channel":{"id":"test"},"output":[["text","string","{{number}} is my lucky number"]]}}'),
       ('branningan-pipe-sink-test-ba4c164f-511e-4855-b7d6-db29472d01a1',
        'server',
        '{"kind": "brannigan","name":"brannigan pipe sink test","trigger":{"channel":{"id":"pipe-mypipe"},"filter":[["something","!!"]]},"action":{"channel":{"id":"test"},"output":[["text","string","{{something}} was piped through!"]]}}')
;

insert into app_journal (uniqueId, lastModified) values
       ('test-2aedfd34-5cf7-4bc5-9ab7-0853037aff12', 1441420637000),
       ('brannigan-pipe-source-006dc6c3-e314-4332-816e-61d49b4601d8',
        1441420637000),
       ('branningan-test-656a9372-68f9-425e-a717-c504d587ea76',
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
