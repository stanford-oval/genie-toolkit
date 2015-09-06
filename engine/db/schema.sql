drop table if exists app ;
drop table if exists app_journal ;

create table app (
       uniqueId varchar(255) primary key,
       tier text not null,
       state text not null
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

insert into app (uniqueId, tier, state) values (
       'config-pairing-65f9bc0f-98e1-450a-9677-64160e200dd5',
       'all',
       '{"kind":"config_pairing"}'
);
insert into app_journal (uniqueId, lastModified) values (
       'config-pairing-65f9bc0f-98e1-450a-9677-64160e200dd5',
       0
);
