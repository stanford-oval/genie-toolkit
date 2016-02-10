drop table if exists oauth2_access_tokens cascade;
drop table if exists oauth2_auth_codes cascade;
drop table if exists users cascade;
drop table if exists oauth2_clients cascade;

create table users (
    id integer auto_increment primary key,
    username varchar(255) unique not null,
    human_name tinytext default null collate utf8_general_ci,
    email varchar(255) not null,
    google_id varchar(255) unique default null,
    facebook_id varchar(255) unique default null,
    password char(64) default null,
    salt char(64) default null,
    cloud_id char(64) unique not null,
    auth_token char(64) not null,
    roles int not null default 0,
    assistant_feed_id varchar(255) default null,
    developer_key char(64) unique default null,
    constraint password_salt check ((password is not null and salt is not null) or
                                    (password is null and salt is null)),
    constraint auth_method check (password is not null or google_id is not null or facebook_id is not null)
) collate = utf8_bin ;

insert into users (
    0, 'root', 'Administrator', null, null,
    'a266940f93a5928c96b50c173c26cad2054c8077e1caa63584dfcfaa4881d2f1',
    '00832c5af6048c2fc9713722ef0c896202e2f1b30a746394900fb0e8132d958d',
    '5f9ea96b5ce8c0b1ab675fd1cd614af7e707332ec461cb96fea7a4414202ee02',
    '6311efb5e042580a3ccd95c6104af72865195fb94045104d6784533b39f77fd6',
    1,
    null, null );

create table oauth2_clients (
    id char(64) primary key,
    secret char(64) not null,
    magic_power boolean not null default false
) collate = utf8_bin ;

create table oauth2_access_tokens (
    user_id integer,
    client_id char(64),
    token char(64) not null,
    primary key (user_id, client_id),
    unique key (token),
    foreign key (user_id) references users(id) on update cascade on delete cascade,
    foreign key (client_id) references oauth2_clients(id) on update cascade on delete cascade
) collate = utf8_bin;

create table oauth2_auth_codes (
    user_id integer,
    client_id char(64),
    code char(64),
    redirectURI tinytext,
    primary key (user_id, client_id),
    key (code),
    foreign key (user_id) references users(id) on update cascade on delete cascade,
    foreign key (client_id) references oauth2_clients(id) on update cascade on delete cascade
) collate = utf8_bin;
