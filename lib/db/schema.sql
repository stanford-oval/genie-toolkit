drop table if exists app ;
drop table if exists app_journal ;

create table app (
       uniqueId varchar(255) primary key,
       tier text not null,
       code text not null,
       state text not null,
       name text null default null,
       description text null default null,
);

create table app_journal (
       uniqueId varchar(255) primary key,
       lastModified datetime
);

drop index if exists app_lastModified ;

create index app_lastModified on app_journal(lastModified) ;

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
drop table if exists keyword_journal ;

create table keyword (
       uniqueId varchar(255) primary key,
       value text default null
);

create table keyword_journal (
       uniqueId varchar(255) primary key,
       lastModified datetime
);
