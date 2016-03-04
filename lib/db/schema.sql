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
