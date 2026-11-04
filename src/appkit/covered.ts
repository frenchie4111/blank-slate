import * as React from 'react';

// True while Blank Slate's own UI (chat, app list, settings) covers the
// app. The app's status-bar settings step aside then, so Blank Slate's light
// status bar shows regardless of which was mounted last.
export const AppCoveredContext = React.createContext(false);
