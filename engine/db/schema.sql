drop table if exists app ;
drop table if exists app_journal ;
drop table if exists device ;
drop table if exists device_journal ;

create table app (
       uniqueId varchar(255) primary key,
       lastModified datetime not null,
       state text not null
);

create table app_journal (
       lastModified datetime primary key,
       uniqueId varchar(255) unique,
       state text
);

create table device (
       uniqueId varchar(255) primary key,
       lastModified datetime not null,
       state text not null
);

create table device_journal (
       lastModified datetime primary key,
       uniqueId varchar(255) unique,
       state text
);
