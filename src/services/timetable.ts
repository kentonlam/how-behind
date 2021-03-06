import { addMinutes, startOfHour, add } from "date-fns";
import { CourseEntry, CourseEntryWithDate, toDateEntry, fromDateEntry } from "./storage";
import { useState, useEffect } from "react";
import firebase from './firebase';

// @ts-ignore
import ICAL from 'ical.js';

export const ID_PREFIX = 'v4|';
export const makeId = (c: CourseEntryWithDate) => 
  (ID_PREFIX + c.course + '|' + c.activity + '|' + c.startDate.toISOString());

// @ts-ignore
export const fixBehindFormat = (c: CourseEntry & Partial<CourseEntryWithDate | CourseEntryTimestamps>) => {
  if (c.startDate === undefined)
    c.startDate = add(fromDateEntry(c.start), { hours: c.time.hour, minutes: c.time.minute });
  else if (typeof c.startDate === 'string')
    c.startDate = new Date(c.startDate);
  else if (c.startDate instanceof firebase.firestore.Timestamp)
    c.startDate = c.startDate.toDate();

  if (c.endDate === undefined)
    c.endDate = addMinutes(c.startDate, c.duration);
  else if (typeof c.endDate === 'string')
    c.endDate = new Date(c.endDate);
  else if (c.endDate instanceof firebase.firestore.Timestamp)
    c.endDate = c.endDate.toDate();

  console.assert(c.startDate instanceof Date, 'startDate is not a Date', c.startDate);

  if (!c?.id?.startsWith(ID_PREFIX))
    c.id = makeId(c as CourseEntryWithDate);

  return c as CourseEntryWithDate;
};

const proxyUrl = (url: string) => {
  return 'https://asia-east2-how-behind.cloudfunctions.net/timetable-proxy?url=' + encodeURIComponent(url);
};

export const compareCourseEntries = (a: CourseEntry, b: CourseEntry) => {
  let x = a.start.localeCompare(b.start);
  if (x !== 0) return x;
  x = a.time.hour - b.time.hour;
  if (x !== 0) return x;
  x = a.time.minute - b.time.minute;
  if (x !== 0) return x;
  return a.duration - b.duration; // shorter duration first.
};

const makeTestEvents = (d: Date): CourseEntryWithDate[] => {
  const events = [];
  const interval = 1;
  const numEvents = Math.ceil(24 * 60 / interval);
  
  let start = startOfHour(d);

  for (let i = 1; i < numEvents; i++) {
    const end = addMinutes(start, interval);

    const event = {
      startDate: start,
      endDate: end,
      activity: 'Test Activity ' + i,
      course: 'TEST2000',
      duration: interval,
      day: 0,
      start: toDateEntry(start),
      frequency: 1,
      time: { hour: start.getHours(), minute: start.getMinutes() }
    };
    // @ts-ignore
    event.id = makeId(event);

    const event2 = {
      startDate: start,
      endDate: end,
      activity: 'Test Activity B' + i,
      course: 'TEST2001',
      duration: interval,
      day: 0,
      start: toDateEntry(start),
      frequency: 1,
      time: { hour: start.getHours(), minute: start.getMinutes() }
    };
    // @ts-ignore
    event2.id = makeId(event2);

    events.push(event as CourseEntryWithDate);
    events.push(event2 as CourseEntryWithDate);
    
    start = end;
  };

  events.sort(compareCourseEntries);

  return events;
};

export const useTimetableEvents = (ical?: string) => {
  const [data, setData] = useState<CourseEntryWithDate[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // console.log("useTimetableEvents: " + ical);
  useEffect(() => {
    if (!ical) {
      // console.log("No ical url specified. Not fetching.");
      setLoading(false);
      return;
    }
    if (ical === '__TEST__') {
      setLoading(false);
      setData(makeTestEvents(new Date()));
      return;
    }

    setLoading(true);
    // console.log("Initiating ical fetch...");
    fetch(proxyUrl(ical))
      .then(resp => resp.text())
      .then(data => {

        // console.log("Received ical response.");
        const jcal = ICAL.parse(data);
        const comp = new ICAL.Component(jcal);
        const events: CourseEntryWithDate[] = comp.getAllSubcomponents('vevent')
          .map((x: any) => new ICAL.Event(x))
          .map((ev: any) => {
            const top = ev.description.split('\n')[0]
            const course: string = top.split('_')[0];
            const activity = top.split(', ').slice(1).join(', ');
            const duration = ev.duration.toSeconds() / 60;
            const start: Date = ev.startDate.toJSDate();
            const day = start.getDay();
            return {
              startDate: start, endDate: ev.endDate.toJSDate(),
              activity, course, duration, day, start: toDateEntry(start), time: { hour: start.getHours(), minute: start.getMinutes() },
              frequency: 1, 
            };
          })
          .map((c: any): CourseEntryWithDate => {
            c.id = makeId(c);
            return c;
          });

        events.sort(compareCourseEntries);
        // console.log("Caching " + events.length + " events.");
        setData(events);
        setLoading(false);
      })
      .catch(() => {
        setData(undefined);
        setLoading(false);
      });
  }, [ical]);
  return [data, loading] as const;
}