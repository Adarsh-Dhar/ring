/**
 * Google Calendar Events API
 * Handles listing and creating calendar events
 */

import { google } from 'googleapis';
import { getAuthedClient } from './authClient';
import { GOOGLE_CALENDAR_ID } from './config';

export async function listCalendarEvents(userId: string, timeMin?: Date, timeMax?: Date) {
  const client = await getAuthedClient(userId);
  if (!client) {
    return null;
  }

  const calendar = google.calendar({ version: 'v3', auth: client });

  try {
    const response = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: timeMin?.toISOString(),
      timeMax: timeMax?.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return response.data.items || [];
  } catch (error) {
    console.error('Failed to list calendar events', error);
    return null;
  }
}

export async function createCalendarEvent(
  userId: string,
  eventData: {
    summary: string;
    description?: string;
    start: Date;
    end: Date;
  }
) {
  const client = await getAuthedClient(userId);
  if (!client) {
    return null;
  }

  const calendar = google.calendar({ version: 'v3', auth: client });

  try {
    const response = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: eventData.summary,
        description: eventData.description,
        start: {
          dateTime: eventData.start.toISOString(),
        },
        end: {
          dateTime: eventData.end.toISOString(),
        },
      },
    });

    return response.data;
  } catch (error) {
    console.error('Failed to create calendar event', error);
    return null;
  }
}
