-- Cockroach db can be downloaded using following commands:
--    wget -qO- https://binaries.cockroachdb.com/cockroach-v20.2.10.linux-amd64.tgz | tar xvz
--    curl https://binaries.cockroachdb.com/cockroach-v20.2.10.darwin-10.9-amd64.tgz | tar -xJ
--
-- The following commandline starts a local node for testing:
--    cockroach start-single-node  --insecure --listen-addr=localhost:8888 --store=type=mem,size=640MiB
--     
-- The following command can be use to initialize the databse for testing:
--    cockroach sql --url postgresql://root@localhost:8888?sslmode=disable < schema.sql 

drop database if exists thingengine;
create database thingengine; 
use thingengine;

drop table if exists app ;

create table app (
       uniqueId varchar(255) primary key,
       code text not null,
       state text not null,
       name text null default null,
       description text null default null
);

drop table if exists device ;
drop table if exists device_journal ;

create table device (
       uniqueId varchar(255) primary key,
       state text not null
);

create table device_journal (
       uniqueId varchar(255) primary key,
       lastModified integer
);

drop index if exists device_lastModified;

create index device_lastModified on device_journal(lastModified) ;

drop table if exists channel ;

create table channel (
       uniqueId varchar(255) primary key,
       value text default null
);
drop table if exists app ;

create table app (
       uniqueId varchar(255) primary key,
       code text not null,
       state text not null,
       name text null default null,
       description text null default null
);

drop table if exists device ;
drop table if exists device_journal ;

create table device (
       uniqueId varchar(255) primary key,
       state text not null
);

-- cockroach's equivalent sqlite datetime type, timestamptz, doesn't support epoch.
-- To uses epoch, we has to use an experimental function such as this:
--     `upsert into (lastModified) values(experimental_strptime($2, '%s'))`, [Math.round(lastModified/1000)]);
-- To ensure compatability with Postgres SQL, the lastmodified type is changed to integer.
create table device_journal (
       uniqueId varchar(255) primary key,
       lastModified integer
);

drop index if exists device_lastModified;

create index device_lastModified on device_journal(lastModified) ;

drop table if exists keyword ;

create table keyword (
       uniqueId varchar(255) primary key,
       value text default null
);

drop table if exists channel ;

create table channel (
       uniqueId varchar(255) primary key,
       value text default null
);

drop table if exists permissions;

create table permissions (
        uniqueId varchar(255) primary key,
        compat_key text not null,
        code text not null,
        extra text default null
);

create index permissions_compat_key on permissions(compat_key);

drop table if exists matrix_sync;
create table matrix_sync (
    owner_id text,
    object_key text,
    object_value text,
    primary key(owner_id, object_key)
);

drop table if exists matrix_accountData;
create table matrix_accountData (
    owner_id text,
    object_key text,
    object_value text,
    primary key(owner_id, object_key)
);

drop table if exists matrix_users;
create table matrix_users (
    owner_id text,
    object_key text,
    object_value text,
    primary key(owner_id, object_key)    
);

drop table if exists matrix_outgoingRoomKeyRequests ;
create table matrix_outgoingRoomKeyRequests (
    owner_id text,
    request_id text,
    room_id text,
    session_id text,
    state int,
    object text,
    primary key(owner_id, request_id)
);
create index matrix_outgoingRoomKeyRequests_session on matrix_outgoingRoomKeyRequests(owner_id, room_id, session_id);
create index matrix_outgoingRoomKeyRequests_state on matrix_outgoingRoomKeyRequests(owner_id, state);

create table if not exists memory_table_meta (
    name text primary key,
    args text,
    types text
);
