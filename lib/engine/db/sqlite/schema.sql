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

drop table if exists channel ;

create table channel (
       uniqueId varchar(255) primary key,
       value text default null
);

drop table if exists conversation ;

create table conversation (
       uniqueId varchar(255) primary key,
       conversationId varchar(255),
       previousId varchar(255),
       dialogueId varchar(255),
       context text default null,
       agent text default null,
       agentTimestamp text default null,
       agentTarget text default null,
       intermediateContext text default null,
       user text default null,
       userTimestamp text default null,
       userTarget text default null,
       vote text default null,
       comment text default null
);

drop table if exists conversation_state;

create table conversation_state (
       uniqueId varchar(255) primary key,
       dialogueState text default null,
       lastMessageId int(11) default null,
       recording boolean default false
);

create table conversation_history (
       uniqueId varchar(255) primary key,
       conversationId varchar(255) not null,
       messageId int(11) not null,
       message text not null
);
create unique index conversation_history_messageId on
       conversation_history(conversationId, messageId);
