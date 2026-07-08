import { createContext, useCallback, useContext, useEffect, useMemo, useState, PropsWithChildren } from "react";
import { useAuth } from "../context/AuthContext";
import {
  fetchUserSettings,
  setLanguage as persistLanguage,
  setSpoilerMode as persistSpoilerMode,
  Language,
} from "./userSettings";
import { setSupabaseAlertLanguage } from "./supabase";

export type { Language };

const en = {
  login: {
    tagline: "Track your shows",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    noAccount: "No account? Create one",
  },
  signup: {
    title: "Create an account",
    email: "Email",
    password: "Password",
    username: "Username",
    signUp: "Sign up",
    hasAccount: "Already have an account? Sign in",
    success: "Account created. Check your inbox if a confirmation is required.",
    usernameInvalid: "3 to 20 letters, numbers or underscores.",
    usernameTaken: "That username is already taken.",
  },
  tabs: {
    shows: "Shows",
    movies: "Movies",
    explore: "Explore",
    profile: "Profile",
  },
  shows: {
    tabList: "My list",
    tabUpcoming: "Upcoming",
    history: "History",
    watchNext: "Watch next",
    notStarted: "Not started",
    emptyToday: "Nothing planned today.",
    emptyWatchList: "Add shows to follow to see them here.",
  },
  movies: {
    title: "Movies",
    empty: "No movies yet.",
    watchedOn: (date: string) => `Watched on ${date}`,
    watchCount: (n: number) => (n === 1 ? "Watched once" : `Watched ${n} times`),
    overview: "Overview",
    tabList: "My list",
    tabUpcoming: "Upcoming",
    emptyUpcoming: "Your watchlist is empty — add movies from Explore or a movie's page.",
    emptyWatchlist: "Add movies to your watchlist to see them here.",
    releasesOn: (date: string) => `Releases ${date}`,
    addToWatchlist: "Add to watchlist",
    inWatchlist: "In watchlist",
    markWatched: "Mark as watched",
    removeFromList: "Remove from list",
  },
  explore: {
    title: "Discover",
    searchPlaceholder: "Search for a show or movie",
    noResults: (query: string) => `No results for "${query}".`,
    ended: "Ended",
    running: "Running",
    categoryPopular: "Most popular",
    categoryComedy: "Comedy",
    categoryDrama: "Drama",
    categoryKdrama: "K-Drama",
    categorySciFi: "Sci-Fi",
    categoryNew: "New releases",
    categoryPopularMovies: "Popular",
    categoryTopRatedMovies: "Top rated",
    categoryNowPlayingMovies: "In theaters",
    categoryUpcomingMovies: "Coming soon",
    resultsShows: "Shows",
    resultsMovies: "Movies",
    noMatchTitle: "Show not found",
    noMatchDesc: "This show isn't available on TVmaze, which the app uses to track episodes.",
  },
  profile: {
    statistics: "Statistics",
    favorites: "Favorites",
    lists: "Lists",
    shows: "Shows",
    dropped: "Stopped",
    settings: "Settings",
    followers: "Followers",
    following: "Following",
    watchTime: "Show watch time",
    episodesWatched: "Episodes watched",
    months: "months",
    days: "days",
    hours: "hours",
    movieWatchTime: "Movie watch time",
    moviesWatched: "Movies watched",
    movies: "Movies",
    noMovies: "No movies yet.",
    noFavorites: "No favorites yet.",
    noShows: "No shows yet.",
    noDropped: "No stopped shows.",
    paused: "Paused",
    noPaused: "No paused shows.",
    seriesCount: (n: number) => `${n} show${n > 1 ? "s" : ""}`,
    createList: "Create a list",
    newListPlaceholder: "List name",
    importTitle: "Import from TV Time",
    importSubtitle: "Load your CSV or JSON export retrieved from TV Time (by Refract) to get your history back.",
    importInvalidFileTitle: "Invalid file",
    importInvalidFileMsg: "Choose a CSV or JSON export from TV Time.",
    importMatching: "Matching shows",
    importImporting: "Importing episodes",
    importDoneTitle: "Import complete",
    importDone: (shows: number, episodes: number, movies: number) =>
      `${shows} show(s) imported, ${episodes} episode(s) marked as watched, ${movies} movie(s) imported.`,
    importUnmatched: (n: number, names: string) => `\n${n} show(s) not found on TVmaze: ${names}`,
    importFailedTitle: "Import failed",
    importFailedUnknown: "Unknown error.",
    importReadError: "Couldn't read the selected file.",
    spoilerMode: "Spoiler mode",
    spoilerModeDesc: "See other people's comments even on episodes you haven't watched yet.",
    language: "Language",
    legal: "Legal",
    termsAndConditions: "Terms & Conditions",
    privacyPolicy: "Privacy Policy",
    contactUs: "Contact us",
    signOut: "Sign out",
  },
  showDetail: {
    inMyList: "In my list",
    addToMyList: "Add to my list",
    infos: "Info",
    episodes: "Episodes",
    info: "Info",
    toContinue: "Continue watching",
    allEpisodes: "All episodes",
    season: (n: number) => `Season ${n}`,
    present: "Present",
    resumeTracking: "Resume tracking",
    stopShow: "Stop show",
    pauseShow: "Pause show",
    resumeFromPause: "Resume show",
    removeFavorite: "Remove from favorites",
    addFavorite: "Add to favorites",
    addToAList: "Add to a list",
    removeFromList: "Remove from my list",
    newListPlaceholder: "New list",
    cast: "Cast",
    comments: "Comments",
  },
  episodeDetail: {
    notWatched: "Not watched yet",
    remainingAll: "All episodes have been watched",
    remaining: (n: number) => `${n} episode${n > 1 ? "s" : ""} left`,
    yourRating: "Your rating",
    howDidYouFeel: "How did it make you feel?",
    othersFelt: "How others felt",
    comments: "Comments",
    unwatchedPrompt: "Mark this episode as watched to rate it, react, and see comments.",
  },
  comments: {
    placeholder: "Add a comment...",
    empty: "No comments yet. Be the first!",
    unknownUser: "Someone",
    postError: "Couldn't post your comment. Try again.",
  },
  characterVote: {
    title: "Favorite character",
    voteCount: (n: number) => `${n} vote${n > 1 ? "s" : ""}`,
  },
  feelings: {
    lol: "Hilarious",
    shocked: "Shocked",
    heartbroken: "Heartbreaking",
    mindblown: "Mindblown",
    bored: "Boring",
  },
  rewatchPrompt: {
    alreadyWatched: "You've already marked this as watched",
    whatToDo: "What do you want to do?",
    unwatch: "I haven't watched it",
    rewatch: "I watched it again",
  },
  previousEpisodesPrompt: {
    title: "You skipped some episodes",
    subtitle: "Have you already watched the earlier ones too?",
    onlyThis: "Just this episode",
    allPrevious: "Yes, mark them all watched",
  },
  episodeRow: {
    premiere: "PREMIERE",
    new: "NEW",
    aired: "AIRED",
    days: "DAYS",
    markWatched: "Mark watched",
    remaining: (n: number) => `${n} left`,
    totalEpisodes: (n: number) => `${n} episode${n > 1 ? "s" : ""}`,
  },
  listDetail: {
    title: "List",
    empty: "No shows in this list.",
  },
  social: {
    setUsernameTitle: "Choose a username",
    setUsernameDesc: "Pick a username so other people can find and follow you.",
    usernamePlaceholder: "Username",
    save: "Save",
    findPeople: "Find people",
    searchTitle: "Find people",
    searchPlaceholder: "Search by username",
    noUsersFound: (query: string) => `No one found for "${query}".`,
    searchHint: "Search for a username to find people to follow.",
    follow: "Follow",
    following: "Following",
    unfollow: "Unfollow",
    followers: "Followers",
    followersTitle: "Followers",
    followingTitle: "Following",
    noFollowers: "No followers yet.",
    noFollowing: "Not following anyone yet.",
    notifications: "Notifications",
    noNotifications: "No notifications yet.",
    startedFollowingYou: "started following you",
  },
};

const fr: typeof en = {
  login: {
    tagline: "Suis tes séries",
    email: "Email",
    password: "Mot de passe",
    signIn: "Se connecter",
    noAccount: "Pas de compte ? Créer un compte",
  },
  signup: {
    title: "Créer un compte",
    email: "Email",
    password: "Mot de passe",
    username: "Pseudo",
    signUp: "S'inscrire",
    hasAccount: "Déjà un compte ? Se connecter",
    success: "Compte créé. Vérifie ta boîte mail si une confirmation est requise.",
    usernameInvalid: "3 à 20 lettres, chiffres ou underscores.",
    usernameTaken: "Ce pseudo est déjà pris.",
  },
  tabs: {
    shows: "Séries",
    movies: "Films",
    explore: "Découvrir",
    profile: "Profil",
  },
  shows: {
    tabList: "Ma liste",
    tabUpcoming: "À venir",
    history: "Historique",
    watchNext: "À suivre",
    notStarted: "Pas commencées",
    emptyToday: "Rien de prévu aujourd'hui.",
    emptyWatchList: "Ajoute des séries à suivre pour les voir ici.",
  },
  movies: {
    title: "Films",
    empty: "Aucun film pour l'instant.",
    watchedOn: (date: string) => `Vu le ${date}`,
    watchCount: (n: number) => (n === 1 ? "Vu une fois" : `Vu ${n} fois`),
    overview: "Synopsis",
    tabList: "Ma liste",
    tabUpcoming: "À venir",
    emptyUpcoming: "Ta liste est vide — ajoute des films depuis Explorer ou la page d'un film.",
    emptyWatchlist: "Ajoute des films à ta liste pour les voir ici.",
    releasesOn: (date: string) => `Sortie le ${date}`,
    addToWatchlist: "Ajouter à ma liste",
    inWatchlist: "Dans ma liste",
    markWatched: "Marquer comme vu",
    removeFromList: "Retirer de la liste",
  },
  explore: {
    title: "Découvrir",
    searchPlaceholder: "Chercher une série ou un film",
    noResults: (query: string) => `Aucun résultat pour "${query}".`,
    ended: "Terminée",
    running: "En cours",
    categoryPopular: "Les plus populaires",
    categoryComedy: "Comédies",
    categoryDrama: "Drames",
    categoryKdrama: "K-Drama",
    categorySciFi: "Science-fiction",
    categoryNew: "Dernières sorties",
    categoryPopularMovies: "Les plus populaires",
    categoryTopRatedMovies: "Les mieux notés",
    categoryNowPlayingMovies: "Au cinéma",
    categoryUpcomingMovies: "Bientôt disponibles",
    resultsShows: "Séries",
    resultsMovies: "Films",
    noMatchTitle: "Série introuvable",
    noMatchDesc: "Cette série n'est pas disponible sur TVmaze, que l'app utilise pour suivre les épisodes.",
  },
  profile: {
    statistics: "Statistiques",
    favorites: "Favoris",
    lists: "Listes",
    shows: "Séries",
    dropped: "Arrêtées",
    settings: "Réglages",
    followers: "Abonnés",
    following: "Abonnements",
    watchTime: "Temps séries",
    episodesWatched: "Épisodes vus",
    months: "mois",
    days: "jours",
    hours: "heures",
    movieWatchTime: "Temps films",
    moviesWatched: "Films vus",
    movies: "Films",
    noMovies: "Aucun film pour l'instant.",
    noFavorites: "Aucun favori pour l'instant.",
    noShows: "Aucune série pour l'instant.",
    noDropped: "Aucune série arrêtée.",
    paused: "En pause",
    noPaused: "Aucune série en pause.",
    seriesCount: (n: number) => `${n} série${n > 1 ? "s" : ""}`,
    createList: "Créer une liste",
    newListPlaceholder: "Nom de la liste",
    importTitle: "Importer depuis TV Time",
    importSubtitle: "Charge ton export CSV ou JSON récupéré de TV Time (by Refract) pour récupérer ton historique.",
    importInvalidFileTitle: "Fichier invalide",
    importInvalidFileMsg: "Choisis un export CSV ou JSON de TV Time.",
    importMatching: "Recherche des séries",
    importImporting: "Import des épisodes",
    importDoneTitle: "Import terminé",
    importDone: (shows: number, episodes: number, movies: number) =>
      `${shows} série(s) importée(s), ${episodes} épisode(s) marqué(s) comme vu(s), ${movies} film(s) importé(s).`,
    importUnmatched: (n: number, names: string) => `\n${n} série(s) introuvable(s) sur TVmaze : ${names}`,
    importFailedTitle: "Échec de l'import",
    importFailedUnknown: "Erreur inconnue.",
    importReadError: "Impossible de lire le fichier sélectionné.",
    spoilerMode: "Mode spoilers",
    spoilerModeDesc: "Voir les commentaires des autres même sur les épisodes que tu n'as pas encore vus.",
    language: "Langue",
    legal: "Mentions légales",
    termsAndConditions: "Conditions d'utilisation",
    privacyPolicy: "Politique de confidentialité",
    contactUs: "Nous contacter",
    signOut: "Se déconnecter",
  },
  showDetail: {
    inMyList: "Dans ma liste",
    addToMyList: "Ajouter à ma liste",
    infos: "Infos",
    episodes: "Épisodes",
    info: "Informations",
    toContinue: "À continuer",
    allEpisodes: "Tous les épisodes",
    season: (n: number) => `Saison ${n}`,
    present: "Présent",
    resumeTracking: "Reprendre le suivi",
    stopShow: "Arrêter la série",
    pauseShow: "Mettre en pause",
    resumeFromPause: "Reprendre la série",
    removeFavorite: "Retirer des favoris",
    addFavorite: "Ajouter aux favoris",
    addToAList: "Ajouter à une liste",
    removeFromList: "Retirer de ma liste",
    newListPlaceholder: "Nouvelle liste",
    cast: "Acteurs",
    comments: "Commentaires",
  },
  episodeDetail: {
    notWatched: "Pas encore vu",
    remainingAll: "Tous les épisodes ont été vus",
    remaining: (n: number) => `${n} épisode${n > 1 ? "s" : ""} restant${n > 1 ? "s" : ""}`,
    yourRating: "Ta note",
    howDidYouFeel: "Comment tu l'as vécu ?",
    othersFelt: "Le ressenti des autres",
    comments: "Commentaires",
    unwatchedPrompt: "Marque l'épisode comme vu pour le noter, réagir et voir les commentaires.",
  },
  comments: {
    placeholder: "Ajouter un commentaire...",
    empty: "Aucun commentaire pour l'instant. Sois le premier !",
    unknownUser: "Quelqu'un",
    postError: "Impossible d'envoyer ton commentaire. Réessaie.",
  },
  characterVote: {
    title: "Personnage préféré",
    voteCount: (n: number) => `${n} vote${n > 1 ? "s" : ""}`,
  },
  feelings: {
    lol: "Hilarant",
    shocked: "Choc",
    heartbroken: "Déchirant",
    mindblown: "Dingue",
    bored: "Ennuyeux",
  },
  rewatchPrompt: {
    alreadyWatched: "Tu as déjà marqué ça comme vu",
    whatToDo: "Qu'est-ce que tu veux faire ?",
    unwatch: "Je ne l'ai pas regardé",
    rewatch: "Je l'ai revu",
  },
  previousEpisodesPrompt: {
    title: "Tu as sauté des épisodes",
    subtitle: "As-tu déjà vu les épisodes précédents aussi ?",
    onlyThis: "Juste cet épisode",
    allPrevious: "Oui, tout marquer comme vu",
  },
  episodeRow: {
    premiere: "PREMIÈRE",
    new: "NOUVEAU",
    aired: "DIFFUSÉ",
    days: "JOURS",
    markWatched: "Marquer comme vu",
    remaining: (n: number) => `${n} restant${n > 1 ? "s" : ""}`,
    totalEpisodes: (n: number) => `${n} épisode${n > 1 ? "s" : ""}`,
  },
  listDetail: {
    title: "Liste",
    empty: "Aucune série dans cette liste.",
  },
  social: {
    setUsernameTitle: "Choisis un pseudo",
    setUsernameDesc: "Choisis un pseudo pour que les autres puissent te trouver et te suivre.",
    usernamePlaceholder: "Pseudo",
    save: "Enregistrer",
    findPeople: "Trouver des amis",
    searchTitle: "Trouver des amis",
    searchPlaceholder: "Chercher un pseudo",
    noUsersFound: (query: string) => `Personne trouvé pour "${query}".`,
    searchHint: "Cherche un pseudo pour trouver des personnes à suivre.",
    follow: "Suivre",
    following: "Suivi(e)",
    unfollow: "Ne plus suivre",
    followers: "Abonnés",
    followersTitle: "Abonnés",
    followingTitle: "Abonnements",
    noFollowers: "Aucun abonné pour l'instant.",
    noFollowing: "Ne suit encore personne.",
    notifications: "Notifications",
    noNotifications: "Aucune notification pour l'instant.",
    startedFollowingYou: "a commencé à te suivre",
  },
};

const dictionaries = { en, fr };

export type Translations = typeof en;

interface SettingsContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  spoilerMode: boolean;
  setSpoilerMode: (enabled: boolean) => void;
  t: Translations;
}

const SettingsContext = createContext<SettingsContextValue>({
  language: "en",
  setLanguage: () => {},
  spoilerMode: false,
  setSpoilerMode: () => {},
  t: en,
});

export function LanguageProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const [language, setLanguageState] = useState<Language>("en");
  const [spoilerMode, setSpoilerModeState] = useState(false);

  useEffect(() => {
    if (!session) {
      setLanguageState("en");
      setSpoilerModeState(false);
      return;
    }
    fetchUserSettings()
      .then((settings) => {
        setLanguageState(settings.language);
        setSpoilerModeState(settings.spoiler_mode);
      })
      .catch(() => {});
  }, [session]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    persistLanguage(lang).catch(() => {});
  }, []);

  const setSpoilerMode = useCallback((enabled: boolean) => {
    setSpoilerModeState(enabled);
    persistSpoilerMode(enabled).catch(() => {});
  }, []);

  useEffect(() => {
    setSupabaseAlertLanguage(language);
  }, [language]);

  const value = useMemo(
    () => ({ language, setLanguage, spoilerMode, setSpoilerMode, t: dictionaries[language] }),
    [language, setLanguage, spoilerMode, setSpoilerMode]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useLanguage() {
  return useContext(SettingsContext);
}
