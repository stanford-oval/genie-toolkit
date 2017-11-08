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
       lastModified datetime
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

create table matrix_sync (
    owner_id text,
    object_key text,
    object_value text,
    primary key(owner_id, object_key)
);
create table matrix_accountData (
    owner_id text,
    object_key text,
    object_value text,
    primary key(owner_id, object_key)
);
create table matrix_users (
    owner_id text,
    object_key text,
    object_value text,
    primary key(owner_id, object_key)
);

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
