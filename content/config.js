export const MESSAGE_TYPES = {
  bootstrap: "GET_HOME_BOOTSTRAP",
  continue: "GET_HOME_CONTINUE",
  favorites: "GET_HOME_FAVORITES",
  friendPreview: "GET_HOME_FRIEND_PREVIEW",
  friends: "GET_HOME_FRIENDS",
  recommended: "GET_HOME_RECOMMENDED",
  userSearch: "SEARCH_HOME_USERS",
  profileAvatar: "GET_PROFILE_AVATAR",
  profileBadges: "GET_PROFILE_BADGES",
  profileBootstrap: "GET_PROFILE_BOOTSTRAP",
  profileCommunities: "GET_PROFILE_COMMUNITIES",
  profileCreations: "GET_PROFILE_CREATIONS",
  profileFavorites: "GET_PROFILE_FAVORITES",
  profileFriends: "GET_PROFILE_FRIENDS",
  profileFriendRequest: "REQUEST_PROFILE_FRIEND",
  profileFollow: "FOLLOW_PROFILE_USER",
};

export const EVENTS = {
  componentConnected: "roblox-extension:component-connected",
  componentDisconnected: "roblox-extension:component-disconnected",
  homeRefresh: "roblox-extension:home-refresh",
  profileRefresh: "roblox-extension:profile-refresh",
  joinRequest: "roblox-extension:join-server",
  joinResult: "roblox-extension:join-server-result",
  routeChange: "roblox-extension:route-change",
  userError: "roblox-extension:user-error",
  userReady: "roblox-extension:user-ready",
};

export const GAME_FEEDS = {
  continue: {
    ariaLabel: "Recently played experiences",
    emptyMessage: "Play an experience and it will appear here.",
    errorMessage: "Your recently played experiences could not be loaded.",
    invalidMessage: "Roblox returned an invalid Continue list.",
    messageType: MESSAGE_TYPES.continue,
    title: "Continue",
  },
  favorites: {
    ariaLabel: "Favorite experiences",
    blockedMessage: "Sign in to load your favorite experiences.",
    emptyMessage: "Experiences you favorite will appear here.",
    errorMessage: "Your favorite experiences could not be loaded.",
    invalidMessage: "Roblox returned an invalid Favorites list.",
    messageType: MESSAGE_TYPES.favorites,
    requiresUser: true,
    title: "Favorites",
  },
  recommended: {
    emptyMessage: "Roblox has no recommendations available.",
    errorMessage: "Recommendations could not be loaded.",
    invalidMessage: "Roblox returned invalid recommendations.",
    landscape: true,
    messageType: MESSAGE_TYPES.recommended,
    title: "Recommended For You",
  },
};
