// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


/**
 * The name of the dialogue policy
 */
 export const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

 /**
  * Metadata about this dialogue policy
  */
 export const MANIFEST = {
     name: POLICY_NAME,

     dialogueActs: {
         user: [
             // user says hi!
             'greet',
             // user says they want to do something else (same as greet but without the "hi" part)
             'reinit',
             // user issues a ThingTalk program
             'execute',
             // user wants to see the result of the previous program (in reply to a generic search question)
             'ask_recommend',
             // user insists in reiterating the same search after an empty search error
             'insist',
             // user wants to see more output from the previous result
             'learn_more',
             // user asks to see an output parameter from the previous result
             'action_question',
             // user says closes the dialogue mid-way (in the middle of a search)
             'cancel',
             // user terminates the dialogue after the agent asked if there is anything
             // else the user wants
             // "end" is a terminal state, it has no continuations
             // (the agent replies with sys_goodbye which itself generates no user reply)
             'end',
             // pseudo state used to enter the dialogue state machine for notifications
             'notification',
             // pseudo state used to enter the dialogue state machine before the first turn
             'init',

             // pseudo states used to answer legacy questions and questions outside the state machine
             'answer',
             'answer_choice',
         ],
         agent: [
             // agent says hi back
             'sys_greet',
             // agent asks a question to refine a query (with or without a parameter)
             'sys_search_question',
             'sys_generic_search_question',
             // agent asks a question to slot fill a program
             'sys_slot_fill',
             // agent recommends one, two, three, four, or more results from the program (with or without an action)
             'sys_recommend_one',
             'sys_recommend_two',
             'sys_recommend_three',
             'sys_recommend_four',
             'sys_recommend_many',
             // agent displays the result of a non-list query (incl. aggregation)
             'sys_display_result',
             // agent proposes a refined query
             'sys_propose_refined_query',
             // agent asks the user what they would like to hear
             'sys_learn_more_what',
             // agent informs that the search is empty (with and without a slot-fill question)
             'sys_empty_search_question',
             'sys_empty_search',
             // agent confirms the action before executing it
             'sys_confirm_action',
             // agent executed the action successfully (and shows the result of the action)
             'sys_action_success',
             // agent had an error in executing the action (with and without a slot-fill question)
             'sys_action_error_question',
             'sys_action_error',
             // agent started a rule (command with stream) successfully
             'sys_rule_enable_success',
             // agent asks if anything else is needed
             'sys_anything_else',
             // agent says good bye
             'sys_end',
             // agent asks the user a free-form command
             'sys_record_command',


             // profile resolution dialogue acts (semi-legacy)
             'sys_resolve_contact',
             'sys_resolve_device',
             'sys_ask_phone_number',
             'sys_ask_email_address',
             'sys_resolve_location',
             'sys_resolve_time',
             'sys_configure_notifications',
         ],
         withParam: [
             'action_question',
             'notification',
             'sys_search_question',
             'sys_slot_fill',
             'sys_empty_search_question',
             'sys_action_error_question'
         ],
     },

     terminalAct: 'sys_end'
 } as const;
