# Ring Event Types Guide

## Downloadable Event Types ✅

These event types are downloadable via Ring's Media Clips API:

- **`motion`** - Motion detection events (security cameras)
- **`ding`** - Doorbell press events (video doorbells)
- **`doorbell_motion`** - Motion detected by doorbell cameras
- **`doorbell_motion_detected`** - Smart motion detection events

## Non-Downloadable Event Types ❌

These event types are **NOT** downloadable via Ring's Media Clips API:

- **`on_demand`** - Manually triggered recordings (via app or web)
- **`manual`** - Manual recordings

## How to Generate Downloadable Clips

### For Security Cameras:
1. Enable motion detection in Ring app settings
2. Walk in front of the camera to trigger motion events
3. These will appear as `motion` event type
4. These events will be downloadable

### For Video Doorbells:
1. Enable motion detection in Ring app settings
2. Walk in front of the doorbell to trigger motion events
3. Press the doorbell button to trigger `ding` events
4. These will appear as `doorbell_motion` or `ding` event types
5. These events will be downloadable

## Current Status

Your camera currently only has **`on_demand`** events (manually triggered recordings). These are not downloadable via Ring's API.

## Solution

To get downloadable clips, you need to:

1. **Enable automatic recording** in your Ring camera settings
2. **Trigger automatic events**:
   - Walk in front of the camera (motion)
   - Press the doorbell button (if applicable)
3. **Wait for Ring to process** the events (usually 1-2 minutes)
4. **Refresh the clips page** to see the new downloadable events

## Using the Clips Page

The updated clips page now includes:

- **Filter toggle**: "Only downloadable" button to show only downloadable clips
- **Event type info**: Header section showing which event types are downloadable
- **Visual indicators**: Non-downloadable clips appear greyed out with disabled play buttons
- **Helpful messages**: Clear explanations when no downloadable clips are found

## API Implementation

The code correctly:
- Marks only automatic events as downloadable
- Filters out `on_demand` events when "Only downloadable" is enabled
- Provides clear error messages when attempting to download non-downloadable events
- Follows Ring's API documentation for downloadable event types

## Why Can't We Download on_demand Events?

Ring's Media Clips API explicitly does not allow downloading manually triggered recordings. This is a Ring API policy, not a limitation of this implementation. The API returns `403 TIME_RANGE_NOT_AUTHORIZED` for these events regardless of authentication or request format.
