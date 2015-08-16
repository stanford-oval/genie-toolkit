drop table if exists users cascade;

create table users (
    id integer auto_increment primary key,
    username varchar(255) unique not null,
    salt char(64) not null,
    password varchar(255) not null,
    cloud_id char(64) unique not null,
    auth_token char(64) not null
) collate = utf8_bin ;
