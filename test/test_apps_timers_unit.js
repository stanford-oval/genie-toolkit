// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const timers = require('../lib/apps/timers');

function testTimer_setTimems() {
	let timer = new timers.Timer(null, null);
	let tests = [
		{
			date: 1546329600000, // Date.parse("1 Jan 2019")
			timems: 0, // 00:00:00
			expected: 1546329600000, // Date.parse("1 Jan 2019")
		},
		{
			date: 1546374896000, // Date.parse("1 Jan 2019 12:34:56")
			timems: 43200000, // 12:00:00
			expected: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
		},
		{
			date: 1546329600000, // Date.parse("1 Jan 2019")
			timems: 45296000, // 12:34:56
			expected: 1546374896000, // Date.parse("1 Jan 2019 12:34:56")
		},
		{
			date: 1546329600000, // Date.parse("1 Jan 2019")
			timems: 86400000, // 1 day
			expected: 1546416000000, // Date.parse("2 Jan 2019")
		},
	]
	console.log("Testing _setTimems...");
	tests.forEach((test, i) => {
		assert.strictEqual(timer._setTimems(test.date, test.timems), test.expected);
		console.log(`#${i} passed`);
	})
}

function testTimer_getTimems() {
	let timer = new timers.Timer(null, null);
	let tests = [
		{
			date: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			expected: 0, // 00:00:00
		},
		{
			date: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			expected: 43200000, // 12:00:00
		},
		{
			date: 1546374896000, // Date.parse("1 Jan 2019 12:34:56")
			expected: 45296000, // 12:34:56
		},
	]
	console.log("Testing _getTimems...");
	tests.forEach((test, i) => {
		assert.strictEqual(timer._getTimems(test.date), test.expected);
		console.log(`#${i} passed`);
	})
}

function testTimer_splitDay() {
	// Expected values here need to be changed if we change hardcoded values 
	// TIME_12PM, REASONABLE_START_TIME and REASONABLE_INTERVAL in the 
	// function
	let timer = new timers.Timer(null, null);
	let tests = [
		{
			frequency: 1,
			expected: [43200000], // 12PM
		},
		{
			frequency: 2,
			expected: [32400000, 75600000], // 9AM, 9PM
		},
		{
			frequency: 3,
			expected: [32400000, 54000000, 75600000], // 9AM, 3PM, 9PM
		},
		{
			frequency: 13,
			expected: [32400000, 36000000, 39600000, 43200000, 46800000, 50400000, 54000000, 57600000, 61200000, 64800000, 68400000, 72000000, 75600000], // 9AM, 10AM, 11AM ... 7PM, 8PM, 9PM
		},
		{
			frequency: 8,
			expected: [32400000, 38571429, 44742857, 50914286, 57085714, 63257143, 69428571, 75600000], // 09:00:00, 10:42:51, 12:25:42, 14:08:34, 15:51:25, 17:34:17, 19:17:08, 21:00:00
		},
	]
	console.log("Testing _splitDay...");
	tests.forEach((test, i) => {
		assert.deepStrictEqual(timer._splitDay(test.frequency), test.expected);
		console.log(`#${i} passed`);
	})
}

function testTimer_getEarliest() {
	// Expected values here need to be changed if we change hardcoded values 
	// TIME_12PM, REASONABLE_START_TIME and REASONABLE_INTERVAL in the 
	// function
	let timer = new timers.Timer(null, null);
	let tests = [
		{
			base: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			timings: [43200000], // 12PM
			expected: 1546372800000 // Date.parse("1 Jan 2019 12:00:00")
		},
		{
			base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			timings: [32400000, 75600000], // 9AM, 9PM
			expected: 1546405200000 // Date.parse("1 Jan 2019 21:00:00")
		},
		{
			base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			timings: [32400000, 43200000, 75600000], // 9AM, 12PM, 9PM
			expected: 1546372800000 // Date.parse("1 Jan 2019 12:00:00")
		},
		{
			base: 1546408800000, // Date.parse("1 Jan 2019 22:00:00")
			timings: [32400000, 75600000], // 9AM, 9PM
			expected: 1546448400000 // Date.parse("2 Jan 2019 22:00:00")
		},
	]
	console.log("Testing _getEarliest...");
	tests.forEach((test, i) => {
		assert.strictEqual(timer._getEarliest(test.base, test.timings), test.expected);
		console.log(`#${i} passed`);
	})
}

function testTimer_nextTimeout() {
	let timer = new timers.Timer(null, null);
	let tests = [
		// Once a day should return 12pm
		{
			_base: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			_interval: 86400000,
			_frequency: null,
			_now: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			expected: 43200000 // 12h
		},
		{
			_base: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			_interval: 86400000,
			_frequency: 1,
			_now: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			expected: 43200000 // 12h
		},
		{	
			_base: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			_interval: 86400000,
			_frequency: 1,
			_now: 1546934400000, // Date.parse("8 Jan 2019 00:00:00")
			expected: 43200000 // 12h
		},
		{
			_base: 1546448400000, // Date.parse("2 Jan 2019 22:00:00")
			_interval: 86400000,
			_frequency: 1,
			_now: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			expected: 129600000 // 36h
		},
		// Twice a day should return 9am and 9pm
		{
			_base: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			_interval: 86400000,
			_frequency: 2,
			_now: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			expected: 32400000 // 9h
		},
		{
			_base: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			_interval: 86400000,
			_frequency: 2,
			_now: 1546401600000, // Date.parse("1 Jan 2019 20:00:00")
			expected: 3600000 // 1h
		},
		{
			_base: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			_interval: 86400000,
			_frequency: 2,
			_now: 1546405201000, // Date.parse("1 Jan 2019 21:00:01")
			expected: 43199000 // 11h59m59s
		},
		// 13 times a day should return 9am, 10am ... 8pm, 9pm
		{
			_base: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			_interval: 86400000,
			_frequency: 13,
			_now: 1546362000000, // Date.parse("1 Jan 2019 09:00:00")
			expected: 0
		},
		{
			_base: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			_interval: 86400000,
			_frequency: 13,
			_now: 1546362001000, // Date.parse("1 Jan 2019 09:00:01"),
			expected: 3599000 // 59m59s
		},
		// If interval != DAY and base is in the future,
		// simply return time to base
		{
			_base: 1546416000000, // Date.parse("2 Jan 2019 00:00:00")
			_interval: 7 * 86400000,
			_frequency: 1,
			_now: 1546329600000, // Date.parse("1 Jan 2019 00:00:00")
			expected: 86400000 // 24h
		},
		// Once a week should return same time (from base)
		{
			_base: 1546374896000, // Date.parse("1 Jan 2019 12:34:56")
			_interval: 7 * 86400000,
			_frequency: 1,
			_now: 1546979640000, // Date.parse("8 Jan 2019 12:34:00")
			expected: 56000 // 56s
		},
		// 2 times a week should alert on baseDay and
		// baseDay + 4
		{
			_base: 1546374896000, // Date.parse("1 Jan 2019 12:34:56")
			_interval: 7 * 86400000,
			_frequency: 2,
			_now: 1546720440000, // Date.parse("5 Jan 2019 12:34:00")
			expected: 56000 // 56s
		},
		{
			_base: 1546374896000, // Date.parse("1 Jan 2019 12:34:56")
			_interval: 7 * 86400000,
			_frequency: 2,
			_now: 1546893240000, // Date.parse("7 Jan 2019 12:34:00")
			expected: 86456000 // 1d 56s
		},
		// 3 times a week should alert on MonWedFri
		{
			_base: 1546369871000, // Date.parse("1 Jan 2019 11:11:11")
			_interval: 7 * 86400000,
			_frequency: 3,
			_now: 1546801860000, // Date.parse("6 Jan 2019 11:11:00")
			expected: 86411000 // 1d 11s
		},
		{
			_base: 1546369871000, // Date.parse("1 Jan 2019 11:11:11")
			_interval: 7 * 86400000,
			_frequency: 3,
			_now: 1546974660000, // Date.parse("8 Jan 2019 11:11:00")
			expected: 86411000 // 1d 11s
		},
		{
			_base: 1546369871000, // Date.parse("1 Jan 2019 11:11:11")
			_interval: 7 * 86400000,
			_frequency: 3,
			_now: 1547233860000, // Date.parse("11 Jan 2019 11:11:00")
			expected: 11000 // 11s
		},
		// 4 times a week should alert on MonTueThuFri
		{
			_base: 1546369871000, // Date.parse("1 Jan 2019 11:11:11")
			_interval: 7 * 86400000,
			_frequency: 4,
			_now: 1546888270000, // Date.parse("7 Jan 2019 11:11:10")
			expected: 1000 // 1s
		},
		{
			_base: 1546369871000, // Date.parse("1 Jan 2019 11:11:11")
			_interval: 7 * 86400000,
			_frequency: 4,
			_now: 1546974670000, // Date.parse("8 Jan 2019 11:11:10")
			expected: 1000 // 1s
		},
		{
			_base: 1546369871000, // Date.parse("1 Jan 2019 11:11:11")
			_interval: 7 * 86400000,
			_frequency: 4,
			_now: 1547020800000, // Date.parse("9 Jan 2019 00:00:00")
			expected: 126671000 // 1d 11h 11m 11s
		},
		{
			_base: 1546369871000, // Date.parse("1 Jan 2019 11:11:11")
			_interval: 7 * 86400000,
			_frequency: 4,
			_now: 1546542672000, // Date.parse("3 Jan 2019 11:11:12")
			expected: 86399000 // 23h 59m 59s
		},
		// 5 days a week should run on weekdays
		{
			_base: 1546405871000, // Date.parse("1 Jan 2019 21:11:11")
			_interval: 7 * 86400000,
			_frequency: 5,
			_now: 1546888271000, // Date.parse("7 Jan 2019 11:11:11")
			expected: 36000000 // 10h
		},
		{
			_base: 1546405871000, // Date.parse("1 Jan 2019 21:11:11")
			_interval: 7 * 86400000,
			_frequency: 5,
			_now: 1546974671000, // Date.parse("8 Jan 2019 11:11:11")
			expected: 36000000 // 10h
		},
		{
			_base: 1546405871000, // Date.parse("1 Jan 2019 21:11:11")
			_interval: 7 * 86400000,
			_frequency: 5,
			_now: 1547665871000, // Date.parse("16 Jan 2019 11:11:11")
			expected: 36000000 // 10h
		},
		{
			_base: 1546405871000, // Date.parse("1 Jan 2019 21:11:11")
			_interval: 7 * 86400000,
			_frequency: 5,
			_now: 1548357071000, // Date.parse("24 Jan 2019 11:11:11")
			expected: 36000000 // 10h
		},
		{
			_base: 1546405871000, // Date.parse("1 Jan 2019 21:11:11")
			_interval: 7 * 86400000,
			_frequency: 5,
			_now: 1547233871000, // Date.parse("11 Jan 2019 11:11:11")
			expected: 36000000 // 10h
		},
		// 6 days a week should run on all days except Sunday
		{
			_base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			_interval: 7 * 86400000,
			_frequency: 6,
			_now: 1546881154000, // Date.parse("7 Jan 2019 09:12:34")
			expected: 10046000 // 2h 47m 26s
		},
		{
			_base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			_interval: 7 * 86400000,
			_frequency: 6,
			_now: 1546967554000, // Date.parse("8 Jan 2019 09:12:34")
			expected: 10046000 // 2h 47m 26s
		},
		{
			_base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			_interval: 7 * 86400000,
			_frequency: 6,
			_now: 1547053954000, // Date.parse("9 Jan 2019 09:12:34")
			expected: 10046000 // 2h 47m 26s
		},
		{
			_base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			_interval: 7 * 86400000,
			_frequency: 6,
			_now: 1547140354000, // Date.parse("10 Jan 2019 09:12:34")
			expected: 10046000 // 2h 47m 26s
		},
		{
			_base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			_interval: 7 * 86400000,
			_frequency: 6,
			_now: 1547226754000, // Date.parse("11 Jan 2019 09:12:34")
			expected: 10046000 // 2h 47m 26s
		},
		{
			_base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			_interval: 7 * 86400000,
			_frequency: 6,
			_now: 1547313154000, // Date.parse("12 Jan 2019 09:12:34")
			expected: 10046000 // 2h 47m 26s
		},
		{
			_base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			_interval: 7 * 86400000,
			_frequency: 6,
			_now: 1547399554000, // Date.parse("13 Jan 2019 09:12:34")
			expected: 96446000 // 1d 2h 47m 26s
		},
		// 7 days a week should run on all days
		{
			_base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			_interval: 7 * 86400000,
			_frequency: 7,
			_now: 1546881154000, // Date.parse("7 Jan 2019 09:12:34")
			expected: 10046000 // 2h 47m 26s
		},
		{
			_base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			_interval: 7 * 86400000,
			_frequency: 7,
			_now: 1548177154000, // Date.parse("22 Jan 2019 09:12:34")
			expected: 10046000 // 2h 47m 26s
		},
		{
			_base: 1546372800000, // Date.parse("1 Jan 2019 12:00:00")
			_interval: 7 * 86400000,
			_frequency: 7,
			_now: 1598112754000, // Date.parse("22 Aug 2020 09:12:34")
			expected: 10046000 // 2h 47m 26s
		},
		// Once per N days should return same time (from base)
		// but N days later
		{
			_base: 1546720496000, // Date.parse("5 Jan 2019 12:34:56")
			_interval: 42 * 86400000,
			_frequency: 1,
			_now: 1550349240000, // Date.parse("16 Feb 2019 12:34:00")
			expected: 56000 // 56s
		},
		// K times per N days should do simple division
		// to get day then use time from base
		{
			_base: 1546720496000, // Date.parse("5 Jan 2019 12:34:56")
			_interval: 42 * 86400000,
			_frequency: 13, // 13 times every 42 days ~ once every 3-ish days
			_now: 1546979640000, // Date.parse("8 Jan 2019 12:34:00")
			expected: 56000 // 56s
		},
		// If interval < DAY, do simple divide
		{
			_base: 1546720496000, // Date.parse("5 Jan 2019 12:34:56")
			_interval: 60000,
			_frequency: 3,
			_now: 1546720497000, // Date.parse("5 Jan 2019 12:34:57")
			expected: 19000 // 19s
		},
		{
			_base: 1546720496000, // Date.parse("5 Jan 2019 12:34:56")
			_interval: 360000,
			_frequency: 7,
			_now: 1546720497000, // Date.parse("5 Jan 2019 12:34:57")
			expected: 50429 // 50.429s
		},
	]
	console.log("Testing _nextTimeout...");
	tests.forEach((test, i) => {
		timer._base = test._base;
		timer._interval = test._interval;
		timer._frequency = test._frequency;
		assert.strictEqual(timer._nextTimeout(test._now), test.expected);
		console.log(`#${i} passed`);
	})
}

module.exports = function testUnits() {
    testTimer_setTimems();
    testTimer_getTimems();
    testTimer_splitDay();
    testTimer_getEarliest();
    testTimer_nextTimeout();
};
