drop table if exists users cascade;

create table users (
    id integer auto_increment primary key,
    username varchar(255) unique not null,
    human_name tinytext default null collate utf8_general_ci,
    google_id varchar(255) unique default null,
    facebook_id varchar(255) unique default null,
    password varchar(255) default null,
    salt char(64) default null,
    cloud_id char(64) unique not null,
    auth_token char(64) not null,
    constraint password_salt check ((password is not null and salt is not null) or
                                    (password is null and salt is null)),
    constraint auth_method check (password is not null or google_id is not null or facebook_id is not null)
) collate = utf8_bin ;
