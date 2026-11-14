// EduLabs live classes: appended by the web container to the generated config.js.
// Install: cp to ${CONFIG}/web/custom-config.js (runbook step 5). EduLabs also passes per-person options when it opens a
// class (students muted, camera off, their language); those cannot grant anything the token does not.

// Phones stay in the browser.
config.disableDeepLinking = true;
config.deeplinking = { disabled: true };

// The name comes from the token; students cannot change it, invite others or see third-party content.
config.readOnlyName = true;
config.disableInviteFunctions = true;
config.disableThirdPartyRequests = true;
config.gravatar = { disabled: true };
config.giphy = { enabled: false };
config.analytics = { disabled: true };

// No lobby UI (the lobby is off on the server too), no moderator hand-over to students.
config.securityUi = { hideLobbyButton: true, disableLobbyPassword: true };
config.remoteVideoMenu = { disableGrantModerator: true };

// Cameras are off in these classes: receive at most four videos, so a phone never downloads fifteen.
config.channelLastN = 4;
