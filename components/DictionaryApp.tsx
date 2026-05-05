"use client";

import React, { useState, useEffect } from 'react';
import { Search, Volume2, Bookmark, Menu, Sun, Star, Moon, RefreshCw, Quote, ArrowRight, Lightbulb, History, Trash2, Leaf, TrendingUp, Settings, X, ThumbsUp, ThumbsDown, Flag, CheckCircle, Mic, Download, WifiOff, Brain, Play, Video, Info, Languages, Book, BookOpen, Link, Gamepad2, Tag, Copy, Check, Loader2, ImageIcon, MessageCircle, Share2, AlertTriangle, Calendar, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import Image from 'next/image';
import confetti from 'canvas-confetti';
import { get, set } from 'idb-keyval';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, ReferenceLine } from 'recharts';
import { UserProfile } from './UserProfile';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth } from '../lib/firebase';
import { fetchSavedWordsFromFirestore, syncSavedWordsToFirestore } from '../lib/firestore-sync';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });

interface WordDetails {
  word: string;
  phonetic: string;
  bengaliMeaning: string;
  englishDefinition: string;
  partOfSpeech: string;
  variations?: string[]; // E.g., plural forms, past tense, etc.
  exampleSentence?: string; // Kept for backward compatibility
  exampleSentences?: string[]; // Array of 3 reliable, conversational examples
  examples?: { english: string; bengali: string; context?: string; }[]; // Structured translation examples
  dailySpeakingTip: string;
  speakingTips?: any[]; // Array of structured speaking tips (or string for legacy)
  difficultyLevel?: 'Beginner' | 'Intermediate' | 'Advanced';
  synonyms?: string[];
  relatedWords?: string[];
  isMisspelled?: boolean;
  spellcheckSuggestions?: string[];
}

const CustomTranslateIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="4" />
    <path d="M12 4v16" />
    <text x="7" y="16" fontSize="12" stroke="none" fill="currentColor" fontWeight="bold" textAnchor="middle">অ</text>
    <text x="17" y="16" fontSize="12" stroke="none" fill="currentColor" fontWeight="bold" textAnchor="middle">A</text>
  </svg>
);

const getVariationsRegex = (word: string) => {
  const w = word.toLowerCase();
  const variations = new Set([w, w + 's', w + 'es', w + 'd', w + 'ed', w + 'ing', w + 'ly', w + 'er', w + 'est']);
  if (w.endsWith('y')) {
    const root = w.slice(0, -1);
    variations.add(root + 'ies');
    variations.add(root + 'ied');
    variations.add(root + 'ily');
    variations.add(root + 'ier');
    variations.add(root + 'iest');
  }
  if (w.endsWith('e')) {
    const root = w.slice(0, -1);
    variations.add(root + 'ing');
    variations.add(root + 'ed');
    variations.add(root + 'er');
    variations.add(root + 'est');
  }
  if (/[bcdfghjklmnpqrstvwxyz]$/.test(w)) {
    const double = w + w.slice(-1);
    variations.add(double + 'ed');
    variations.add(double + 'ing');
    variations.add(double + 'er');
    variations.add(double + 'est');
  }
  const escapedVariations = Array.from(variations).map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // sort by length descending to match longest possible variation first
  escapedVariations.sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${escapedVariations.join('|')})\\b`, 'gi');
};

const highlightWord = (text: string, targetWord: string, isDarkMode: boolean) => {
  if (!targetWord || !text) return <>{text}</>;
  
  const regex = getVariationsRegex(targetWord);
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const isVariation = part.toLowerCase() !== targetWord.toLowerCase();
          return (
            <span key={i} className={`font-bold px-1 rounded inline-flex items-baseline ${isDarkMode ? 'text-emerald-300 bg-emerald-900/40' : 'text-emerald-700 bg-emerald-200/50'}`}>
              {part}
              {isVariation && (
                <span className={`ml-1 text-[10px] sm:text-xs font-medium tracking-wide ${isDarkMode ? 'text-emerald-400/60' : 'text-emerald-700/60'}`}>
                  ({targetWord})
                </span>
              )}
            </span>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
};

interface SRSData {
  nextReviewDate: string;
  interval: number;
  easeFactor: number;
  repetitions: number;
}

interface SavedWord extends WordDetails {
  srs?: SRSData;
  notes?: string;
  tags?: string[];
  customExamples?: string[];
}

interface Suggestion {
  word: string;
  definition: string;
  category?: string;
  isSaved?: boolean;
}

interface SearchHistoryItem {
  word: string;
  date: string;
}

interface LearningHistoryEntry {
  date: string;
  wordsLearned: number;
  reviewsCompleted: number;
}

interface UserStats {
  wordsLearned: number;
  totalReviews: number;
  correctReviews: number;
  currentStreak: number;
  lastReviewDate: string | null;
  dailyGoal: number;
  todayReviews: number;
  learningHistory?: LearningHistoryEntry[];
  dailyReminders?: boolean;
}

interface SRSSettings {
  baseInterval: number;
  secondInterval: number;
  startingEase: number;
  learnedThreshold: number;
}

interface FeatureInfo {
  id: string;
  title: string;
  whatItDoes: string[];
  whyYouNeedIt: string[];
  icon: React.ReactNode;
  colorClass: string;
  bgClass: string;
  darkColorClass: string;
  darkBgClass: string;
}

const FEATURES_INFO: Record<string, FeatureInfo> = {
  bengali: {
    id: 'bengali',
    title: "Bengali Meanings",
    whatItDoes: [
      "⚡ Gives you instant Bengali translation.",
      "🔍 Works seamlessly for every word you search."
    ],
    whyYouNeedIt: [
      "🧠 Quick Understanding: Grasp the core meaning instantly.",
      "🛑 No Guesswork: Eliminates confusion right from the start.",
      "🚀 Learn Faster: Makes the initial learning phase smooth and easy."
    ],
    icon: <span className="text-xl font-bold font-outfit">文A</span>,
    colorClass: "text-[#10B981]",
    bgClass: "bg-[#F0FDF8]",
    darkColorClass: "text-emerald-500",
    darkBgClass: "bg-emerald-950/30"
  },
  voice: {
    id: 'voice',
    title: "Voice Pronunciation",
    whatItDoes: [
      "🎧 Plays crystal-clear audio of the word.",
      "🗣️ Shows you exactly how it is spoken out loud."
    ],
    whyYouNeedIt: [
      "👂 Train Your Ear: Reading isn't enough; you must hear the sound.",
      "🎯 Fix Your Accent: Learn the correct stress and tone.",
      "💬 Speak Confidently: Ensure everyone understands you in real life."
    ],
    icon: <Volume2 className="w-6 h-6" />,
    colorClass: "text-orange-500",
    bgClass: "bg-orange-50",
    darkColorClass: "text-orange-500",
    darkBgClass: "bg-orange-950/30"
  },
  tips: {
    id: 'tips',
    title: "Speaking Tips",
    whatItDoes: [
      "📝 Generates personalized speaking advice for each word.",
      "🔍 Highlights tricky syllables, stress points, and silent letters."
    ],
    whyYouNeedIt: [
      "🎤 Your Vocal Coach: Guides you to articulate perfectly.",
      "🌉 Bridge The Gap: Turns reading knowledge into speaking power.",
      "😎 Boost Confidence: Removes the fear of mispronouncing words."
    ],
    icon: <Lightbulb className="w-6 h-6" />,
    colorClass: "text-yellow-600",
    bgClass: "bg-yellow-50",
    darkColorClass: "text-yellow-500",
    darkBgClass: "bg-yellow-950/30"
  },
  save: {
    id: 'save',
    title: "Save Vocabulary",
    whatItDoes: [
      "💾 Saves your favorite words locally on your device.",
      "📂 Builds your very own customized dictionary."
    ],
    whyYouNeedIt: [
      "📶 Always Available: Access your words anytime, even offline.",
      "🚫 Zero Data Loss: Your progress is completely safe.",
      "🔄 Daily Revision: Perfect for consistent, spaced practice."
    ],
    icon: <Bookmark className="w-6 h-6" />,
    colorClass: "text-pink-500",
    bgClass: "bg-pink-50",
    darkColorClass: "text-pink-500",
    darkBgClass: "bg-pink-950/30"
  },
  examples: {
    id: 'examples',
    title: "Real Examples",
    whatItDoes: [
      "✍️ Provides practical, real-life sentences for every word.",
      "🧩 Shows the word used in proper grammatical context."
    ],
    whyYouNeedIt: [
      "💡 Application First: Teaches you how to use it, not just what it means.",
      "🎯 Understand Nuance: See the word in different situations.",
      "🚀 True Fluency: The ultimate key to speaking English naturally."
    ],
    icon: <Quote className="w-6 h-6" />,
    colorClass: "text-sky-500",
    bgClass: "bg-sky-50",
    darkColorClass: "text-sky-500",
    darkBgClass: "bg-sky-950/30"
  }
};

const TRY_WORDS = ['Serendipity', 'Ephemeral', 'Resilience', 'Eloquent', 'Melancholy', 'Wistful', 'Ambiguous', 'Tenacious'];

// Helper components
const CopyButton = ({ text, isDarkMode }: { text: string; isDarkMode: boolean }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy!", err);
    }
  };

  return (
    <button 
      onClick={handleCopy}
      className={`p-1.5 rounded-lg transition-all shrink-0 ${isDarkMode ? 'hover:bg-white/10 text-gray-400 hover:text-emerald-400' : 'hover:bg-gray-100 text-slate-400 hover:text-emerald-600'}`}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
};

export default function DictionaryApp() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'en' | 'bn'>('en');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WordDetails | null>(null);
  const [error, setError] = useState('');
  const [spellSuggestions, setSpellSuggestions] = useState<string[]>([]);
  const [transcriptionFeedback, setTranscriptionFeedback] = useState<{confidence: string, alternatives: string[]} | null>(null);
  const [savedWords, setSavedWords] = useState<SavedWord[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [flashcardImage, setFlashcardImage] = useState<string | null>(null);
  const [isGeneratingFlashcard, setIsGeneratingFlashcard] = useState(false);

  const [userStats, setUserStats] = useState<UserStats>({
    wordsLearned: 0,
    totalReviews: 0,
    correctReviews: 0,
    currentStreak: 0,
    lastReviewDate: null,
    dailyGoal: 10,
    todayReviews: 0,
    dailyReminders: undefined
  });

  const [showStudyReminder, setShowStudyReminder] = useState(false);
  
  // Daily study reminder feature
  useEffect(() => {
    const setupNotifications = async () => {
      // Only request permission if this is a supported browser context
      if (!("Notification" in window)) return;
      
      try {
        let permission = Notification.permission;
        
        // Request permission if not already granted or denied
        if (permission === "default" && userStats.dailyReminders) {
          permission = await Notification.requestPermission();
        }
        
        if (permission === "granted" && userStats.dailyReminders) {
          const lastNotifiedDate = localStorage.getItem("learnEnglishEasy_lastStudyNotificationDate");
          const today = new Date().toDateString();
          
          if (lastNotifiedDate !== today) {
            // Check if there are due words
            const dueWordsCount = savedWords.filter(w => w.srs && new Date(w.srs.nextReviewDate) <= new Date()).length;
            if (dueWordsCount > 0 && userStats.lastReviewDate !== today) {
               new Notification("Time to study!", {
                 body: `You have ${dueWordsCount} word(s) due for review today. Keep up your learning streak!`,
                 icon: "/favicon.ico" // Browser default icon fallback usually
               });
               localStorage.setItem("learnEnglishEasy_lastStudyNotificationDate", today);
            }
          }
        }
      } catch (err) {
        console.error("Failed to setup notifications:", err);
      }
    };
    
    // We run it if user has saved words
    if (savedWords.length > 0 && userStats.dailyReminders !== false) {
      // Small delay so it's not aggressive on initial render
      const timeoutId = setTimeout(() => {
        setupNotifications();
      }, 3000);
      return () => clearTimeout(timeoutId);
    }
  }, [savedWords, userStats.dailyReminders, userStats.lastReviewDate]);

  // In-app Study Reminder Logic
  useEffect(() => {
    if (!isLoaded || savedWords.length === 0) return;
    
    const today = new Date().toDateString();
    
    // Have they already reviewed today?
    if (userStats.lastReviewDate === today) return;
    
    // Has the banner been dismissed today?
    if (localStorage.getItem('learnEnglishEasy_reminderDismissedDate') === today) return;
    
    // Have they explicitly turned OFF reminders?
    if (userStats.dailyReminders === false) return;
    
    const dueWordsCount = savedWords.filter(w => w.srs && new Date(w.srs.nextReviewDate) <= new Date()).length;
    
    if (dueWordsCount > 0) {
      setShowStudyReminder(true);
    }
  }, [isLoaded, userStats.lastReviewDate, userStats.dailyReminders, savedWords]);

  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showClearHistoryDialog, setShowClearHistoryDialog] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const [glossarySearchQuery, setGlossarySearchQuery] = useState('');
  const [showDashboard, setShowDashboard] = useState(false);
  const [showTranslator, setShowTranslator] = useState(false);
  const [translationInput, setTranslationInput] = useState("");
  const [translationOutput, setTranslationOutput] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [isTranslatingExamples, setIsTranslatingExamples] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizState, setQuizState] = useState<'start' | 'playing' | 'finished'>('start');
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [quizTimeLeft, setQuizTimeLeft] = useState<number | null>(null);
  const [showQuizSettings, setShowQuizSettings] = useState(false);
  const [quizSettings, setQuizSettings] = useState({
    questionCount: 10,
    timeLimitSeconds: 0,
    types: {
      meaning: true,
      pronunciation: true,
      example: true
    }
  });
  const [difficultyFilter, setDifficultyFilter] = useState<'All' | 'Beginner' | 'Intermediate' | 'Advanced'>('All');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('All');
  const [reviewMode, setReviewMode] = useState<'none' | 'front' | 'back'>('none');
  const [reviewQueue, setReviewQueue] = useState<SavedWord[]>([]);
  const [currentReviewWord, setCurrentReviewWord] = useState<SavedWord | null>(null);
  const [reviewGuess, setReviewGuess] = useState('');
  
  const [srsSettings, setSrsSettings] = useState<SRSSettings>({
    baseInterval: 1,
    secondInterval: 6,
    startingEase: 2.5,
    learnedThreshold: 21
  });
  const [showSettings, setShowSettings] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.9);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  
  // Advanced TTS Settings
  const [ttsEngine, setTtsEngine] = useState<'browser' | 'gemini'>('gemini');
  const [geminiVoice, setGeminiVoice] = useState('Kore');
  const [geminiAccent, setGeminiAccent] = useState('US English');

  // User Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [userAudioUrl, setUserAudioUrl] = useState<string | null>(null);
  const [userAudioBlob, setUserAudioBlob] = useState<Blob | null>(null);
  const [pronunciationScore, setPronunciationScore] = useState<any | null>(null);
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);

  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const [isGeneratingExample, setIsGeneratingExample] = useState(false);

  const [selectedFeatureDetails, setSelectedFeatureDetails] = useState<FeatureInfo | null>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const voiceSearchRecorderRef = React.useRef<MediaRecorder | null>(null);
  const voiceSearchChunksRef = React.useRef<Blob[]>([]);

  const [downloadingWords, setDownloadingWords] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [wordsToDownload, setWordsToDownload] = useState('');
  const [pendingSync, setPendingSync] = useState(false);
  const [downloadedWordsList, setDownloadedWordsList] = useState<string[]>([]);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showBengali, setShowBengali] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('learnEnglishEasy_theme') === 'dark';
    }
    return false;
  });
  const [isOffline, setIsOffline] = useState(false);
  const [wotd, setWotd] = useState<WordDetails | null>(null);
  const [wotdLoading, setWotdLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const searchContainerRef = React.useRef<HTMLDivElement>(null);
  const topSearchContainerRef = React.useRef<HTMLDivElement>(null);
  const isTypingRef = React.useRef(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = React.useRef<any>(null);

  const [user] = useAuthState(auth);

  // Sync with Firestore when auth state changes
  useEffect(() => {
    if (user && isLoaded) {
      const syncData = async () => {
        const firestoreWords = await fetchSavedWordsFromFirestore(user.uid);
        if (firestoreWords.length > 0) {
          setSavedWords(prevWords => {
            const merged = [...prevWords];
            const existingWords = new Set(prevWords.map(w => w.word.toLowerCase()));
            
            firestoreWords.forEach(fw => {
              if (!existingWords.has(fw.word.toLowerCase())) {
                merged.push(fw);
              }
            });
            return merged;
          });
        }
      };
      // Short delay to let local storage load first before merging
      setTimeout(syncData, 500); 
    }
  }, [user, isLoaded]);

  // Save words to idb-keyval and Firestore when updated
  useEffect(() => {
    if (!isLoaded) return;
    const saveWords = async () => {
      try {
        await set('learnEnglishEasy_savedWords', savedWords);
        if (user) {
          await syncSavedWordsToFirestore(user.uid, savedWords);
        }
      } catch (e) {
        console.error("Failed to save words to IndexedDB or Firestore", e);
      }
    };
    saveWords();
  }, [savedWords, isLoaded, user]);

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3000);
  };

  // Handle click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        (searchContainerRef.current && !searchContainerRef.current.contains(target)) &&
        (topSearchContainerRef.current && !topSearchContainerRef.current.contains(target))
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Load saved words, history, and theme on mount
  useEffect(() => {
    const loadSavedWords = async () => {
      try {
        const saved = await get('learnEnglishEasy_savedWords');
        if (saved) {
          setSavedWords(saved);
        } else {
          // Fallback to localStorage for backward compatibility
          const localSaved = localStorage.getItem('learnEnglishEasy_savedWords');
          if (localSaved) {
            const parsed = JSON.parse(localSaved);
            setSavedWords(parsed);
            await set('learnEnglishEasy_savedWords', parsed);
            localStorage.removeItem('learnEnglishEasy_savedWords');
          }
        }
      } catch (e) {
        console.error("Failed to load saved words", e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadSavedWords();
    
    const history = localStorage.getItem('learnEnglishEasy_history');
    if (history) {
      try {
        const parsedHistory = JSON.parse(history);
        if (parsedHistory.length > 0) {
          if (typeof parsedHistory[0] === 'string') {
            setSearchHistory(parsedHistory.map((word: string) => ({ word, date: new Date().toISOString() })));
          } else {
            setSearchHistory(parsedHistory);
          }
        }
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }

    const savedStats = localStorage.getItem('learnEnglishEasy_userStats');
    if (savedStats) {
      try {
        const parsedStats = JSON.parse(savedStats);
        
        // Ensure new fields exist
        if (parsedStats.dailyGoal === undefined) parsedStats.dailyGoal = 10;
        if (parsedStats.todayReviews === undefined) parsedStats.todayReviews = 0;
        if (parsedStats.currentStreak === undefined) parsedStats.currentStreak = 0;
        if (parsedStats.lastReviewDate === undefined) parsedStats.lastReviewDate = null;
        if (parsedStats.wordsLearned === undefined) parsedStats.wordsLearned = 0;
        if (parsedStats.totalReviews === undefined) parsedStats.totalReviews = 0;
        if (parsedStats.correctReviews === undefined) parsedStats.correctReviews = 0;

        // Check if streak is broken or day has changed
        const today = new Date().toDateString();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (parsedStats.lastReviewDate && parsedStats.lastReviewDate !== today) {
          // Reset today's reviews if it's a new day
          parsedStats.todayReviews = 0;
          
          if (parsedStats.lastReviewDate !== yesterday.toDateString()) {
            parsedStats.currentStreak = 0;
          }
        }
        
        setUserStats(parsedStats);
      } catch (e) {
        console.error("Failed to parse user stats", e);
      }
    }

    const savedSrsSettings = localStorage.getItem('learnEnglishEasy_srsSettings');
    if (savedSrsSettings) {
      try {
        setSrsSettings(JSON.parse(savedSrsSettings));
      } catch (e) {
        console.error("Failed to parse SRS settings", e);
      }
    }

    const savedSpeechRate = localStorage.getItem('learnEnglishEasy_speechRate');
    if (savedSpeechRate) {
      setSpeechRate(parseFloat(savedSpeechRate));
    }

    const savedVoiceURI = localStorage.getItem('learnEnglishEasy_voiceURI');
    if (savedVoiceURI) {
      setSelectedVoiceURI(savedVoiceURI);
    }

    const savedTtsEngine = localStorage.getItem('learnEnglishEasy_ttsEngine');
    if (savedTtsEngine) setTtsEngine(savedTtsEngine as 'browser' | 'gemini');

    const savedGeminiVoice = localStorage.getItem('learnEnglishEasy_geminiVoice');
    if (savedGeminiVoice) setGeminiVoice(savedGeminiVoice);

    const savedGeminiAccent = localStorage.getItem('learnEnglishEasy_geminiAccent');
    if (savedGeminiAccent) setGeminiAccent(savedGeminiAccent);

    const savedQuizSettings = localStorage.getItem('learnEnglishEasy_quizSettings');
    if (savedQuizSettings) {
      try {
        setQuizSettings(JSON.parse(savedQuizSettings));
      } catch (e) {
        console.error("Failed to parse quiz settings", e);
      }
    }

    // Load voices
    const loadVoices = () => {
      if (window.speechSynthesis) {
        const voices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
        setAvailableVoices(voices);
      }
    };
    
    if (window.speechSynthesis) {
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    // Set initial offline status and add listeners
    setIsOffline(!navigator.onLine);
    const initialPendingSync = localStorage.getItem('learnEnglishEasy_pendingSync') === 'true';
    setPendingSync(initialPendingSync);

    const loadDownloadedWords = async () => {
      try {
        const cached = await get('learnEnglishEasy_offlineCache') as Record<string, WordDetails> | undefined;
        if (cached) {
          setDownloadedWordsList(Object.keys(cached).sort());
        }
      } catch (e) {
        console.error("Failed to load downloaded words", e);
      }
    };
    loadDownloadedWords();

    const handleOnline = () => {
      setIsOffline(false);
      if (localStorage.getItem('learnEnglishEasy_pendingSync') === 'true') {
        setPendingSync(true);
        setTimeout(() => {
          localStorage.removeItem('learnEnglishEasy_pendingSync');
          setPendingSync(false);
        }, 2000);
      }
    };
    const handleOffline = () => setIsOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Handle populating missing synonyms for saved words gradually
  useEffect(() => {
    let isActive = true;
    const populateMissingSynonyms = async () => {
      const wordsMissingSynonyms = savedWords.filter(w => !w.synonyms || w.synonyms.length === 0);
      if (wordsMissingSynonyms.length === 0) return;

      const wordsToProcess = wordsMissingSynonyms.slice(0, 5); // Batch up to 5 at a time
      const wordsString = wordsToProcess.map(w => w.word).join(', ');

      try {
        const textResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `For each of the following words, provide 3 to 5 simple English synonyms. The words are: ${wordsString}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  word: { type: Type.STRING, description: "The target word" },
                  synonyms: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3 to 5 simple synonyms" }
                },
                required: ["word", "synonyms"]
              }
            }
          }
        });

        if (textResponse.text && isActive) {
          const data = JSON.parse(textResponse.text) as { word: string, synonyms: string[] }[];
          setSavedWords(prev => {
            const updatedWords = [...prev];
            let changed = false;
            
            data.forEach(item => {
              const idx = updatedWords.findIndex(w => w.word.toLowerCase() === item.word.toLowerCase());
              if (idx !== -1 && item.synonyms && item.synonyms.length > 0) {
                updatedWords[idx] = { ...updatedWords[idx], synonyms: item.synonyms };
                changed = true;
              }
            });

            return changed ? updatedWords : prev;
          });
        }
      } catch (e: any) {
        console.error("Failed to populate missing synonyms", e);
        if (e?.message?.includes('Quota exceeded')) {
          console.warn("AI Quota exceeded. Background tasks paused.");
          isActive = false; // Stop further attempts for now
        }
      }
    };

    // run after a short delay so we don't block the UI on load
    const timeout = setTimeout(populateMissingSynonyms, 5000);
    return () => {
      isActive = false;
      clearTimeout(timeout);
    };
  }, [savedWords]);


  
  // Save history to localStorage when updated
  useEffect(() => {
    localStorage.setItem('learnEnglishEasy_history', JSON.stringify(searchHistory));
  }, [searchHistory]);
  
  // Save theme to localStorage and update document.documentElement when updated
  useEffect(() => {
    localStorage.setItem('learnEnglishEasy_theme', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Save stats to localStorage when updated
  useEffect(() => {
    localStorage.setItem('learnEnglishEasy_userStats', JSON.stringify(userStats));
  }, [userStats]);

  // Save SRS settings to localStorage when updated
  useEffect(() => {
    localStorage.setItem('learnEnglishEasy_srsSettings', JSON.stringify(srsSettings));
  }, [srsSettings]);

  // Save voice settings to localStorage when updated
  useEffect(() => {
    localStorage.setItem('learnEnglishEasy_speechRate', speechRate.toString());
  }, [speechRate]);

  useEffect(() => {
    localStorage.setItem('learnEnglishEasy_voiceURI', selectedVoiceURI);
  }, [selectedVoiceURI]);

  useEffect(() => {
    localStorage.setItem('learnEnglishEasy_ttsEngine', ttsEngine);
  }, [ttsEngine]);

  useEffect(() => {
    localStorage.setItem('learnEnglishEasy_geminiVoice', geminiVoice);
  }, [geminiVoice]);

  useEffect(() => {
    localStorage.setItem('learnEnglishEasy_geminiAccent', geminiAccent);
  }, [geminiAccent]);

  useEffect(() => {
    localStorage.setItem('learnEnglishEasy_quizSettings', JSON.stringify(quizSettings));
  }, [quizSettings]);

  useEffect(() => {
    const fetchWotd = async () => {
      const today = new Date().toDateString();
      const cachedWotdDate = localStorage.getItem('learnEnglishEasy_wotd_date');
      const cachedWotdData = localStorage.getItem('learnEnglishEasy_wotd_data');

      if (cachedWotdDate === today && cachedWotdData) {
        try {
          setWotd(JSON.parse(cachedWotdData));
          setWotdLoading(false);
          return;
        } catch (e) {
          console.error("Failed to parse wotd", e);
        }
      }

      // If not cached or new day, pick a word based on the day of the year
      const dayOfYear = Math.floor((new Date().getTime() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 1000 / 60 / 60 / 24);
      const wordToFetch = TRY_WORDS[dayOfYear % TRY_WORDS.length];

      // If offline, we can't fetch. Fall back to previous cached data if available.
      if (!navigator.onLine) {
        if (cachedWotdData) {
          try {
            setWotd(JSON.parse(cachedWotdData));
          } catch (e) {
            console.error("Failed to parse cached WOTD on offline fallback", e);
          }
        }
        setWotdLoading(false);
        return;
      }

      try {
        const textResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Provide the dictionary details for the English word "${wordToFetch}".`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING, description: "The valid English word, capitalized" },
                phonetic: { type: Type.STRING, description: "IPA phonetic transcription, e.g., /rɪˈzɪl.i.əns/" },
                bengaliMeaning: { type: Type.STRING, description: "Direct translation in Bengali" },
                englishDefinition: { type: Type.STRING, description: "A very simple, easy-to-understand English definition, suitable for language learners in plain English." },
                synonyms: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3 to 5 simple English synonyms for the word." },
                relatedWords: { type: Type.ARRAY, items: { type: Type.STRING }, description: "5 words that are semantically related or commonly used together with the searched word." },
                variations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Common variations of the word, like plural forms (e.g., 'apples' for 'apple'), past tense ('walked' for 'walk'), or comparative/superlative forms ('bigger', 'biggest')." },
                partOfSpeech: { type: Type.STRING, description: "e.g., NOUN, VERB, ADJECTIVE (all caps)" },
                examples: { 
                  type: Type.ARRAY, 
                  items: { 
                    type: Type.OBJECT, 
                    properties: { 
                      english: { type: Type.STRING, description: "The English example sentence." }, 
                      bengali: { type: Type.STRING, description: "A highly accurate, contextually relevant Bengali translation of this specific example sentence." },
                      context: { type: Type.STRING, description: "A short 2-3 word note summarizing the grammatical use or context (e.g., 'As a verb', 'Formal business', 'Casual slang')" }
                    },
                    required: ["english", "bengali", "context"] 
                  }, 
                  description: "Exactly 5 accurate, meaningful, and practical real-life conversational example sentences using the word. These should reflect highly natural, everyday spoken/written English (mainly US variant), showcasing contexts that a user can directly implement in their daily life (e.g., at work, talking to friends, ordering food, emails). Each must have an exact Bengali translation." 
                },
                speakingTips: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      english: { type: Type.STRING },
                      bengali: { type: Type.STRING }
                    },
                    required: ["english", "bengali"]
                  },
                  description: "Exactly 5 highly actionable and personalized speaking tips for daily conversation and real-life use. Focus on natural fluency, exact situations to use the word, collocations (words commonly used with it), or pronunciation nuances. Make them directly usable so the learner can sound more like a native speaker today. Each tip must be relevant and meaningful, with an English and a translated Bengali equivalent."
                },
                dailySpeakingTip: { type: Type.STRING, description: "A short tip on how to use this word. Provide this entirely in Bengali." },
                difficultyLevel: { type: Type.STRING, description: "The difficulty level of the word: Beginner, Intermediate, or Advanced" }
              },
              required: ["word", "phonetic", "bengaliMeaning", "englishDefinition", "synonyms", "relatedWords", "variations", "partOfSpeech", "examples", "speakingTips", "dailySpeakingTip", "difficultyLevel"]
            }
          }
        });

        if (textResponse.text) {
          const data = JSON.parse(textResponse.text);

          let exampleToUse = data.examples && data.examples.length > 0 ? data.examples[0].english : (data.exampleSentences && data.exampleSentences.length > 0 ? data.exampleSentences[0] : (data.exampleSentence || ""));
          
          const newWotd = { 
            ...data
          };
          
          setWotd(newWotd);
          localStorage.setItem('learnEnglishEasy_wotd_date', today);
          localStorage.setItem('learnEnglishEasy_wotd_data', JSON.stringify(newWotd));
        }
      } catch (err: any) {
        console.error("Failed to fetch WOTD", err);
        if (err?.message?.includes('Quota exceeded')) {
          console.warn("WOTD fetch aborted: AI Quota exceeded.");
        }
        // Fallback to previous cached word on error
        if (cachedWotdData) {
          try {
            setWotd(JSON.parse(cachedWotdData));
          } catch (e) {
            console.error("Failed to parse cached WOTD on error fallback", e);
          }
        }
      } finally {
        setWotdLoading(false);
      }
    };

    fetchWotd();
  }, []);

  const goHomeInternal = React.useCallback(() => {
    isTypingRef.current = false;
    setResult(null);
    setSearchQuery('');
    setError('');
    setShowHistory(false);
    setShowGlossary(false);
    setShowDashboard(false);
    setShowTranslator(false);
    setShowQuiz(false);
    setShowQuizSettings(false);
    setReviewMode('none');
    setCurrentReviewWord(null);
    setShowSuggestions(false);
  }, []);

  const goHome = React.useCallback(() => {
    if (typeof window !== 'undefined' && window.history.state?.internalAppFeature) {
      window.history.back();
    } else {
      goHomeInternal();
    }
  }, [goHomeInternal]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const isFeatureOpen = showHistory || showGlossary || showDashboard || showTranslator || showQuiz || showQuizSettings || result !== null || reviewMode !== 'none';
    if (isFeatureOpen && !window.history.state?.internalAppFeature) {
      window.history.pushState({ internalAppFeature: true }, '');
    }
  }, [showHistory, showGlossary, showDashboard, showTranslator, showQuiz, showQuizSettings, result, reviewMode]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = (e: PopStateEvent) => {
      if (!e.state?.internalAppFeature) {
        goHomeInternal();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [goHomeInternal]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => (prev > -1 ? prev - 1 : prev));
    } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
      e.preventDefault();
      handleSearch(undefined, suggestions[selectedSuggestionIndex].word);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!isTypingRef.current) return;

      if (!searchQuery.trim() || searchQuery.trim().length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        setSuggestionsLoading(false);
        return;
      }
      
      setSuggestionsLoading(true);
      try {
        const queryLower = searchQuery.toLowerCase();
        
        // 1. Get local suggestions from savedWords
        const localMatchesRaw = savedWords.filter(w => {
          if (searchMode === 'en') {
            return w.word.toLowerCase().startsWith(queryLower) || w.word.toLowerCase().includes(queryLower);
          } else {
            return w.bengaliMeaning?.includes(queryLower) || w.englishDefinition?.toLowerCase().includes(queryLower);
          }
        });

        const localMatches = localMatchesRaw.map(w => ({
          word: w.word,
          definition: w.englishDefinition || '',
          category: w.partOfSpeech || '',
          isSaved: true,
          easeFactor: w.srs?.easeFactor || 2.5,
          nextReviewDate: w.srs?.nextReviewDate || new Date().toISOString()
        }));

        // Rank local matches: Priority to due words, then lower ease factor (harder words)
        const now = new Date().getTime();
        localMatches.sort((a, b) => {
          const aDue = new Date(a.nextReviewDate).getTime() <= now ? 1 : 0;
          const bDue = new Date(b.nextReviewDate).getTime() <= now ? 1 : 0;
          if (aDue !== bDue) return bDue - aDue;
          return a.easeFactor - b.easeFactor;
        });

        // 2. Get AI suggestions
        const suggestionPrompt = searchMode === 'en'
          ? `Provide 5 relevant English word suggestions for the prefix/query "${searchQuery}". Prioritize high-frequency and commonly used vocabulary in everyday English. For each, provide a short definition and a category (e.g., Noun, Verb, Adjective).`
          : `Provide 5 English translations or words related to the Bengali concept/word "${searchQuery}". Prioritize high-frequency English vocabulary. Give the English word, its English definition, and a category (Noun, Verb, Adjective).`;

        const res = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: suggestionPrompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  word: { type: Type.STRING },
                  definition: { type: Type.STRING },
                  category: { type: Type.STRING }
                },
                required: ["word", "definition", "category"]
              }
            }
          }
        });

        if (res.text) {
          const aiSuggestions = JSON.parse(res.text) as Suggestion[];
          
          // Merge local and AI suggestions
          const merged: Suggestion[] = [];
          const seenWords = new Set<string>();

          // Add up to 3 top local matches first
          for (const match of localMatches.slice(0, 3)) {
            if (!seenWords.has(match.word.toLowerCase())) {
              merged.push({ word: match.word, definition: match.definition, category: match.category, isSaved: true });
              seenWords.add(match.word.toLowerCase());
            }
          }

          // Fill the rest with AI suggestions (up to 7 max total)
          for (const sug of aiSuggestions) {
            if (merged.length >= 7) break;
            if (!seenWords.has(sug.word.toLowerCase())) {
              merged.push(sug);
              seenWords.add(sug.word.toLowerCase());
            }
          }

          setSuggestions(merged);
          setShowSuggestions(true);
          setSelectedSuggestionIndex(-1);
        }
      } catch (err: any) {
        console.error("Failed to fetch suggestions", err);
      } finally {
        setSuggestionsLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchSuggestions, 500);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchMode, savedWords]);

  const toggleListening = async () => {
    if (isListening) {
      if (voiceSearchRecorderRef.current) {
        voiceSearchRecorderRef.current.stop();
        voiceSearchRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
      setIsListening(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      voiceSearchRecorderRef.current = mediaRecorder;
      voiceSearchChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceSearchChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(voiceSearchChunksRef.current, { type: 'audio/webm' });
        voiceSearchChunksRef.current = [];
        
        // Convert blob to base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1];
          try {
            setSearchQuery("Listening...");
            const response = await ai.models.generateContent({
              model: "gemini-3.1-pro-preview",
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/webm",
                        data: base64Audio
                      }
                    },
                    {
                      text: "Transcribe the audio. Output a JSON object with: 'transcript' (string, the most likely transcription, empty if unintelligible), 'confidence' ('high', 'medium', or 'low'), and 'alternatives' (array of strings, alternative similar-sounding words or phrases, at most 3)."
                    }
                  ]
                }
              ],
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    transcript: { type: Type.STRING },
                    confidence: { type: Type.STRING },
                    alternatives: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["transcript", "confidence", "alternatives"]
                }
              }
            });
            const dataText = response.text || "{}";
            let transcript = "";
            let confidence = "low";
            let alternatives: string[] = [];
            try {
               const data = JSON.parse(dataText);
               transcript = data.transcript?.trim() || "";
               confidence = data.confidence || "low";
               alternatives = data.alternatives || [];
            } catch (e) {
               console.error("Failed to parse transcription JSON", e);
            }

            const cleanTranscript = transcript.replace(/\.$/, '');
            isTypingRef.current = false;
            
            if (cleanTranscript) {
              setSearchQuery(cleanTranscript);
              if (confidence === 'high') {
                handleSearch(undefined, cleanTranscript);
              } else {
                setTranscriptionFeedback({ confidence, alternatives });
              }
            } else {
              setSearchQuery("");
            }
          } catch (error: any) {
            console.error("Transcription error:", error);
            setSearchQuery("");
            if (error?.message?.includes('Quota exceeded')) {
              alert("The AI service has reached its daily request limit. Please try again tomorrow.");
            } else {
              alert("Failed to process audio due to a network or AI service error.");
            }
          }
        };
      };

      mediaRecorder.start();
      setIsListening(true);
    } catch (err) {
      console.error("Mic error:", err);
      alert("Could not access microphone.");
    }
  };

  const handleShareWotd = async (e: React.MouseEvent) => {
    e.stopPropagation(); // prevent clicking the card to search
    if (!wotd) return;
    const text = `Word of the Day: ${wotd.word}\nMeaning: ${wotd.englishDefinition}\nBengali Translation: ${wotd.bengaliMeaning}\n\nLearn more on PolyglotAI!`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Word of the Day',
          text: text,
        });
      } catch (err) {
        console.error("Error sharing:", err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        alert("Word of the Day copied to clipboard!");
      } catch (err) {
        console.error("Clipboard error:", err);
        alert("Failed to copy share text to clipboard.");
      }
    }
  };

  const fetchWordData = async (wordToFetch: string, lang: 'en' | 'bn' = 'en'): Promise<WordDetails | null> => {
    try {
      const promptInfo = `
Provide the dictionary details for the target English word.
When generating the 5 example sentences in the 'examples' array, you MUST prioritize practical, easy-to-understand conversational examples emphasizing real-life situations. Avoid overly formal or poetic examples unless appropriate. Use extremely natural phrasing that a native speaker uses in daily conversation. Ensure each example is accompanied by an exact Bengali translation.
`;
      const prompt = lang === 'en' 
        ? `${promptInfo}\nThe user searched for the English word "${wordToFetch}". If the input seems misspelled or is not a valid English word, set 'isMisspelled' to true, provide up to 3 spellcheck suggestions in 'spellcheckSuggestions', and provide the dictionary details for the most likely intended English word in the 'word' field and subsequent fields.`
        : `${promptInfo}\nThe user provided the phrase "${wordToFetch}" (likely Bengali). Find the most accurate single English translation. Provide the full dictionary details for that English word. Make sure the 'word' field is the English translation.`;
        
      const textResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING, description: "The valid English word, capitalized" },
              phonetic: { type: Type.STRING, description: "IPA phonetic transcription, e.g., /rɪˈzɪl.i.əns/" },
              bengaliMeaning: { type: Type.STRING, description: "Direct translation in Bengali" },
              englishDefinition: { type: Type.STRING, description: "A very simple, easy-to-understand English definition, suitable for language learners in plain English." },
              synonyms: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3 to 5 simple English synonyms for the word." },
              relatedWords: { type: Type.ARRAY, items: { type: Type.STRING }, description: "5 words that are semantically related or commonly used together with the searched word." },
              variations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Common variations of the word, like plural forms (e.g., 'apples' for 'apple'), past tense ('walked' for 'walk'), or comparative/superlative forms ('bigger', 'biggest')." },
              partOfSpeech: { type: Type.STRING, description: "e.g., NOUN, VERB, ADJECTIVE (all caps)" },
              isMisspelled: { type: Type.BOOLEAN, description: "Set to true ONLY if the originally requested English word was misspelled. Otherwise, false." },
              spellcheckSuggestions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "If isMisspelled is true, provide 1 to 3 alternate valid English words. Otherwise, an empty array." },
              examples: { 
                type: Type.ARRAY, 
                items: { 
                  type: Type.OBJECT, 
                  properties: { 
                    english: { type: Type.STRING, description: "The English example sentence." }, 
                    bengali: { type: Type.STRING, description: "A highly accurate, contextually relevant Bengali translation of this specific example sentence." },
                    context: { type: Type.STRING, description: "A short 2-3 word note summarizing the grammatical use or context (e.g., 'As a verb', 'Formal business', 'Casual slang')" }
                  },
                  required: ["english", "bengali", "context"] 
                }, 
                description: "Exactly 5 practical, easy-to-understand conversational examples emphasizing real-life situations. Avoid overly formal or poetic examples unless appropriate. Use extremely natural phrasing that a native speaker uses in daily conversation. Each must have an exact Bengali translation." 
              },
              speakingTips: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    english: { type: Type.STRING },
                    bengali: { type: Type.STRING }
                  },
                  required: ["english", "bengali"]
                },
                description: "Exactly 5 highly actionable and personalized speaking tips for daily conversation and real-life use. Focus on informal usage, 'how it sounds in real life', phrases to combine it with, or pronunciation nuances. Make them directly usable so the learner can sound more like a native speaker today. Each tip must be relevant and meaningful, with an English and a translated Bengali equivalent."
              },
              dailySpeakingTip: { type: Type.STRING, description: "An overall practical advice in Bengali on how to use this word in daily life effortlessly." },
              difficultyLevel: { type: Type.STRING, description: "The difficulty level of the word: Beginner, Intermediate, or Advanced" }
            },
            required: ["word", "phonetic", "bengaliMeaning", "englishDefinition", "synonyms", "relatedWords", "variations", "partOfSpeech", "examples", "speakingTips", "dailySpeakingTip", "difficultyLevel", "isMisspelled", "spellcheckSuggestions"]
          }
        }
      });

      if (textResponse.text) {
        const data = JSON.parse(textResponse.text);

        if (data.word.toLowerCase().includes('invalid') || data.word.includes(' ')) {
          return null;
        }

        // Simply return the data, relying on the high-quality examples generated in the primary Gemini response.
        return { 
          ...data
        };
      }
    } catch (err: any) {
      console.error(`Failed to fetch data for ${wordToFetch}`, err);
      throw err;
    }
    return null;
  };

  const handleBulkDownload = async () => {
    const words = wordsToDownload.split(',').map(w => w.trim()).filter(w => w);
    if (words.length === 0) return;

    setDownloadingWords(true);
    setDownloadProgress(0);

    const cacheKey = 'learnEnglishEasy_offlineCache';
    let offlineCache: Record<string, WordDetails> = {};
    try {
      const cached = await get(cacheKey);
      if (cached) offlineCache = cached;
    } catch (e) {
      console.error("Failed to get offline cache from IndexedDB", e);
    }
    
    let downloadedCount = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!offlineCache[word.toLowerCase()]) {
        try {
          const data = await fetchWordData(word);
          if (data) {
            offlineCache[data.word.toLowerCase()] = data;
            downloadedCount++;
          }
        } catch (err: any) {
          console.error(`Failed to bulk download ${word}`, err);
          if (err?.message?.includes('Quota exceeded')) {
            alert("The AI service quota is exceeded. Stopping bulk downloads for today.");
            break;
          }
        }
      }
      setDownloadProgress(((i + 1) / words.length) * 100);
    }

    try {
      await set(cacheKey, offlineCache);
      setDownloadedWordsList(Object.keys(offlineCache).sort());
    } catch (e) {
      console.error("Failed to save offline cache to IndexedDB", e);
    }
    setDownloadingWords(false);
    setWordsToDownload('');
    
    // Optional: show a temporary success state
    setPendingSync(true);
    setTimeout(() => setPendingSync(false), 2000);
  };

  const removeDownloadedWord = async (wordToRemove: string) => {
    try {
      const cacheKey = 'learnEnglishEasy_offlineCache';
      const cached = await get(cacheKey) as Record<string, WordDetails> | undefined;
      if (cached && cached[wordToRemove.toLowerCase()]) {
        delete cached[wordToRemove.toLowerCase()];
        await set(cacheKey, cached);
        setDownloadedWordsList(Object.keys(cached).sort());
      }
    } catch (e) {
      console.error("Failed to remove downloaded word", e);
    }
  };

  const clearAllDownloadedWords = async () => {
    if (confirm("Are you sure you want to clear all downloaded words?")) {
      try {
        await set('learnEnglishEasy_offlineCache', {});
        setDownloadedWordsList([]);
      } catch (e) {
        console.error("Failed to clear downloaded words", e);
      }
    }
  };

  const translateLegacyExamples = async () => {
    if (!result) return;
    const examplesToTranslate = result.exampleSentences || (result.exampleSentence ? [result.exampleSentence] : []);
    if (examplesToTranslate.length === 0) return;

    setIsTranslatingExamples(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY! });
      const prompt = `The target word is "${result.word}" and its primary meaning is: "${result.englishDefinition}".\n\nI have the following English example sentences:\n${JSON.stringify(examplesToTranslate)}\n\nYour task:\n1. Provide a realistic Bengali translation for each sentence.\n2. Provide a 1-3 word context describing the sentence usage (e.g., 'casual', 'formal').\n\nOutput exactly a JSON array of objects with the structure: [{ "english": "...", "bengali": "...", "context": "..." }]`;

      const aiRes = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                english: { type: Type.STRING },
                bengali: { type: Type.STRING },
                context: { type: Type.STRING }
              },
              required: ["english", "bengali", "context"]
            }
          }
        }
      });

      if (aiRes.text) {
        const translated = JSON.parse(aiRes.text);
        
        const newResult = {
          ...result,
          examples: translated,
          exampleSentences: undefined,
          exampleSentence: undefined
        };
        
        setResult(newResult);
        
        setSavedWords(prev => {
          const newSaved = prev.map(w => w.word === newResult.word ? { ...w, ...newResult } : w);
          localStorage.setItem('learnEnglishEasy_saved', JSON.stringify(newSaved));
          return newSaved;
        });

        const cacheKey = 'learnEnglishEasy_offlineCache';
        const offlineCache = await get(cacheKey) as Record<string, WordDetails> || {};
        if (offlineCache && offlineCache[newResult.word.toLowerCase()]) {
          offlineCache[newResult.word.toLowerCase()] = newResult;
          await set(cacheKey, offlineCache);
        }
      }
    } catch (err) {
      console.error("Failed to translate examples", err);
    } finally {
      setIsTranslatingExamples(false);
    }
  };

  const handleSearch = async (e?: React.FormEvent, wordToSearch?: string) => {
    if (e) e.preventDefault();
    
    const query = wordToSearch || searchQuery.trim();
    if (!query) return;

    isTypingRef.current = false;
    setLoading(true);
    setError('');
    setSpellSuggestions([]);
    setTranscriptionFeedback(null);
    setResult(null);
    setSearchQuery(query);
    setShowBengali(false);
    setUserAudioUrl(null);
    setShowHistory(false);
    setShowGlossary(false);
    setShowDashboard(false);
    setShowTranslator(false);
    setShowQuiz(false);
    setReviewMode('none');
    setCurrentReviewWord(null);
    setShowSuggestions(false);
    setFeedbackSubmitted(false);

    const normalizedQuery = query.toLowerCase();

    try {
      const cacheKey = 'learnEnglishEasy_offlineCache';
      const offlineCache = await get(cacheKey) as Record<string, WordDetails> || {};
      
      if (offlineCache[normalizedQuery]) {
        const cachedResult = offlineCache[normalizedQuery];
        setResult(cachedResult);
        
        // Add to history
        setSearchHistory(prev => {
          const newHistory = [{ word: cachedResult.word, date: new Date().toISOString() }, ...prev.filter(item => item.word.toLowerCase() !== cachedResult.word.toLowerCase())].slice(0, 50);
          return newHistory;
        });
        
        setLoading(false);
        return;
      }
    } catch (e) {
      console.error("Failed to read offline cache for search", e);
    }
    
    if (!navigator.onLine) {
      setError("You are offline. This word is not saved for offline use.");
      setLoading(false);
      return;
    }

    try {
      const data = await fetchWordData(query, searchMode);
      if (data) {
        setResult(data);
        
        try {
          const offlineCache = await get('learnEnglishEasy_offlineCache') as Record<string, WordDetails> || {};
          offlineCache[data.word.toLowerCase()] = data;
          await set('learnEnglishEasy_offlineCache', offlineCache);
        } catch (e) {
          console.error("Failed to auto-save to offline cache", e);
        }
        
        // Add to history
        setSearchHistory(prev => {
          const newHistory = [{ word: data.word, date: new Date().toISOString() }, ...prev.filter(item => item.word.toLowerCase() !== data.word.toLowerCase())].slice(0, 50);
          return newHistory;
        });
      } else {
        setError(`We couldn't find a valid dictionary entry for "${query}".`);
        try {
          const spellcheckPrompt = `The user searched for "${query}" but it doesn't seem to be a valid dictionary word. Provide up to 3 valid English words that they most likely meant. Return a JSON array of strings.`;
          const spellcheckResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: spellcheckPrompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            }
          });
          if (spellcheckResponse.text) {
             const suggestionsData = JSON.parse(spellcheckResponse.text);
             setSpellSuggestions(suggestionsData);
          }
        } catch (e) {
             console.error("Spellcheck failed", e);
        }
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('Quota exceeded')) {
        setError('The AI service has reached its request limit for today. Please try again tomorrow.');
      } else {
        setError("Network or AI service error occurred. Please try again in a few moments.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestionClick = async (word: string) => {
    setResult(null);
    setSearchQuery(word);
    setShowBengali(false);
    setUserAudioUrl(null);
    setShowHistory(false);
    setShowGlossary(false);
    setShowDashboard(false);
    setShowTranslator(false);
    setShowQuiz(false);
    setReviewMode('none');
    setCurrentReviewWord(null);
    setShowSuggestions(false);
    setFeedbackSubmitted(false);

    const normalizedQuery = word.toLowerCase();
    const cacheKey = 'learnEnglishEasy_offlineCache';
    let offlineCache: Record<string, WordDetails> = {};
    
    try {
      const cachedData = await get(cacheKey);
      if (cachedData) {
        offlineCache = cachedData;
      } else {
        // Fallback to localStorage
        const localCached = localStorage.getItem(cacheKey);
        if (localCached) {
          offlineCache = JSON.parse(localCached);
          await set(cacheKey, offlineCache);
          localStorage.removeItem(cacheKey);
        }
      }
    } catch (err) {
      console.error("Failed to get offline cache", err);
    }

    // Check cache first
    if (offlineCache[normalizedQuery]) {
      const cachedResult = offlineCache[normalizedQuery];
      setResult(cachedResult);
      
      // Add to history
      setSearchHistory(prev => {
        const newHistory = [{ word: cachedResult.word, date: new Date().toISOString() }, ...prev.filter(item => item.word.toLowerCase() !== cachedResult.word.toLowerCase())].slice(0, 50);
        return newHistory;
      });
      
      setLoading(false);
      return;
    }

    // If not in cache and offline, show error
    if (!navigator.onLine) {
      setError("You are offline and this word is not cached. Please connect to the internet to search for new words.");
      setLoading(false);
      return;
    }

    try {
      const data = await fetchWordData(word);

      if (data) {
        setResult(data);
        
        // Save to offline cache
        offlineCache[data.word.toLowerCase()] = data;
        try {
          await set(cacheKey, offlineCache);
        } catch (e) {
          console.error("Failed to save offline cache to IndexedDB", e);
        }
        
        // Add to history
        setSearchHistory(prev => {
          const newHistory = [{ word: data.word, date: new Date().toISOString() }, ...prev.filter(item => item.word.toLowerCase() !== data.word.toLowerCase())].slice(0, 50);
          return newHistory;
        });
      } else {
        setError(`We couldn't fetch a valid definition for "${word}". Please check spelling.`);
      }
    } catch (err: any) {
      console.error(err);
      if (err?.message?.includes('Quota exceeded')) {
        setError("The AI service has reached its API request limit for today. Please try again tomorrow.");
      } else {
        setError("An error occurred while fetching the word details. Please check your internet connection.");
      }
    } finally {
      setLoading(false);
    }
  };

  const playPronunciation = async (text: string) => {
    if (ttsEngine === 'gemini') {
      setIsSpeaking(true);
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-tts-preview",
          contents: [{ parts: [{ text: `Say with a ${geminiAccent} accent: ${text}` }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: geminiVoice },
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const sampleRate = 24000;
          const binaryString = atob(base64Audio);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const int16Array = new Int16Array(bytes.buffer);
          const float32Array = new Float32Array(int16Array.length);
          for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
          }
          const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
          audioBuffer.getChannelData(0).set(float32Array);
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = speechRate;
          source.connect(audioContext.destination);
          source.onended = () => setIsSpeaking(false);
          source.start();
        } else {
          setIsSpeaking(false);
        }
      } catch (err: any) {
        console.error("Gemini TTS Error:", err);
        if (err?.message?.includes('Quota exceeded')) {
          alert("The AI voice service quota is exceeded for today. Please switch to Standard (Browser) TTS in settings.");
        }
        setIsSpeaking(false);
      }
      return;
    }

    if (!window.speechSynthesis) {
      alert("Text-to-speech is not supported in your browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    
    if (selectedVoiceURI) {
      const voice = availableVoices.find(v => v.voiceURI === selectedVoiceURI);
      if (voice) {
        utterance.voice = voice;
      }
    } else {
      utterance.lang = 'en-US';
    }
    
    utterance.rate = speechRate;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const playBengaliPronunciation = async (text: string) => {
    setIsSpeaking(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: `Say this Bengali text: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: geminiVoice }, // Can use the same voice, it supports multi-language
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const sampleRate = 24000;
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          float32Array[i] = int16Array[i] / 32768.0;
        }
        const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
        audioBuffer.getChannelData(0).set(float32Array);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = speechRate;
        source.connect(audioContext.destination);
        source.onended = () => setIsSpeaking(false);
        source.start();
      } else {
        setIsSpeaking(false);
      }
    } catch (err) {
      console.error("Gemini TTS Error for Bengali:", err);
      // Fallback to browser TTS for Bengali
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'bn-BD'; // Bengali
        utterance.rate = speechRate;
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
      } else {
        setIsSpeaking(false);
      }
    }
  };

  const startRecording = async () => {
    try {
      setPronunciationScore(null);
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setUserAudioUrl(audioUrl);
        setUserAudioBlob(audioBlob);
        assessPronunciation(audioBlob, currentReviewWord?.word || result?.word || wotd?.word || '');
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access your microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Stop all tracks to release microphone
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const assessPronunciation = async (blob: Blob, targetWord: string) => {
    if (!targetWord || !blob) return;
    setIsAnalyzingAudio(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = (reader.result as string).split(',')[1];
        
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY! });
          const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: [
              {
                role: "user",
                parts: [
                  { text: `Evaluate this pronunciation of the English word: "${targetWord}". Be encouraging, helpful, and detailed. Provide a score out of 100, the phonetic transcription of what the user actually sounded like, general feedback, and 1 to 3 specific actionable tips for improvement. Respond ONLY with a valid JSON object matching the exact schema provided.` },
                  { inlineData: { mimeType: 'audio/webm', data: base64data } }
                ]
              }
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  score: { type: Type.INTEGER, description: "Score out of 100 for the pronunciation accuracy." },
                  feedback: { type: Type.STRING, description: "A brief, encouraging tip or observation about how they said it." },
                  isCorrect: { type: Type.BOOLEAN, description: "Whether the pronunciation is generally understandable and correct." },
                  phoneticTranscription: { type: Type.STRING, description: "The phonetic transcription of what the user sounded like (using IPA)." },
                  specificTips: { type: Type.ARRAY, items: { type: Type.STRING }, description: "1-3 specific, actionable tips on how to improve the pronunciation of this specific word." }
                },
                required: ["score", "feedback", "isCorrect", "phoneticTranscription", "specificTips"]
              }
            }
          });
          
          if (response.text) {
            setPronunciationScore(JSON.parse(response.text));
          }
        } catch (e) {
          console.error("Failed to analyze audio", e);
        } finally {
          setIsAnalyzingAudio(false);
        }
      };
    } catch (e) {
      console.error(e);
      setIsAnalyzingAudio(false);
    }
  };

  const playRecording = () => {
    if (userAudioUrl) {
      const audio = new Audio(userAudioUrl);
      audio.play();
    }
  };

  const toggleSaveWord = (wordDetailsToSave?: WordDetails | React.MouseEvent, e?: React.MouseEvent) => {
    let targetWord = result;
    let event = e;

    if (wordDetailsToSave && 'word' in wordDetailsToSave) {
      targetWord = wordDetailsToSave as WordDetails;
    } else if (wordDetailsToSave && 'currentTarget' in wordDetailsToSave) {
      event = wordDetailsToSave as React.MouseEvent;
    }

    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (!targetWord) return;
    const isSaved = savedWords.some(w => w.word.toLowerCase() === targetWord.word.toLowerCase());
    if (isSaved) {
      setSavedWords(savedWords.filter(w => w.word.toLowerCase() !== targetWord.word.toLowerCase()));
      showToast(`Removed "${targetWord.word}" from vocabulary.`);
    } else {
      const newSavedWord: SavedWord = {
        ...targetWord,
        srs: {
          nextReviewDate: new Date().toISOString(),
          interval: 0,
          easeFactor: srsSettings.startingEase,
          repetitions: 0
        }
      };
      setSavedWords([newSavedWord, ...savedWords]);
      showToast(`Added "${targetWord.word}" to vocabulary.`);
      
      // Update streak when learning/saving a new word
      const today = new Date().toDateString();
      setUserStats(prev => {
        let newStreak = prev.currentStreak || 0;
        let newTodayReviews = prev.todayReviews || 0;
        let history = [...(prev.learningHistory || [])];
        const todayIs = new Date().toISOString().split('T')[0];
        
        const hIdx = history.findIndex(h => h.date === todayIs);
        if (hIdx >= 0) {
          history[hIdx].wordsLearned += 1;
        } else {
          history.push({ date: todayIs, wordsLearned: 1, reviewsCompleted: 0 });
        }
        
        if (prev.lastReviewDate !== today) {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          if (prev.lastReviewDate === yesterday.toDateString()) {
            newStreak += 1;
          } else {
            newStreak = 1;
          }
          newTodayReviews = 0;
        }
        return {
          ...prev,
          currentStreak: newStreak,
          lastReviewDate: today,
          todayReviews: newTodayReviews, // we don't increment todayReviews since that's for reviewing flashcards
          learningHistory: history.slice(-14) // keep last 14 days
        };
      });
    }

    if (!navigator.onLine) {
      localStorage.setItem('learnEnglishEasy_pendingSync', 'true');
      setPendingSync(true);
    }
  };

  const saveWord = (word: WordDetails) => {
    if (savedWords.some(w => w.word.toLowerCase() === word.word.toLowerCase())) return;
    const newWord: SavedWord = { ...word };
    setSavedWords([...savedWords, newWord]);
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#10B981', '#059669', '#34D399']
    });
  };

  const updateSavedWordNotes = (word: string, notes: string) => {
    setSavedWords(prev => prev.map(w => w.word.toLowerCase() === word.toLowerCase() ? { ...w, notes } : w));
  };

  const updateSavedWordTags = (word: string, tagsStr: string) => {
    const tags = Array.from(new Set(tagsStr.split(',').map(t => t.trim().toLowerCase()).filter(t => t)));
    setSavedWords(prev => prev.map(w => w.word.toLowerCase() === word.toLowerCase() ? { ...w, tags } : w));
  };

  const addSavedWordTag = (word: string, tag: string) => {
    setSavedWords(prev => prev.map(w => {
      if (w.word.toLowerCase() === word.toLowerCase()) {
        const currentTags = w.tags || [];
        const normalizedTag = tag.trim().toLowerCase();
        if (normalizedTag && !currentTags.includes(normalizedTag)) {
          return { ...w, tags: [...currentTags, normalizedTag] };
        }
      }
      return w;
    }));
  };

  const removeSavedWordTag = (word: string, tagToRemove: string) => {
    setSavedWords(prev => prev.map(w => {
      if (w.word.toLowerCase() === word.toLowerCase()) {
        const currentTags = w.tags || [];
        return { ...w, tags: currentTags.filter(t => t !== tagToRemove) };
      }
      return w;
    }));
  };

  useEffect(() => {
    setFlashcardImage(null);
  }, [result?.word, currentReviewWord?.word]);

  const updateSavedWordExamples = (word: string, examplesStr: string) => {
    const customExamples = examplesStr.split('\n').map(e => e.trim()).filter(e => e);
    setSavedWords(prev => prev.map(w => w.word.toLowerCase() === word.toLowerCase() ? { ...w, customExamples } : w));
  };

  const generateFlashcardImage = async (overrideWord?: string, overrideDef?: string) => {
    const targetWord = overrideWord || result?.word || currentReviewWord?.word;
    const targetDef = overrideDef || result?.englishDefinition || currentReviewWord?.englishDefinition;
    
    if (!targetWord) return;
    setIsGeneratingFlashcard(true);
    try {
      const prompt = `Create an illustration representing the word "${targetWord}". The art style should be cartoonish+realistic type but not childish. Depict a scene that clearly explains the meaning of "${targetWord}" (${targetDef || ''}).`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: prompt }]
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1"
          }
        }
      });
      
      let imageUrl = null;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const base64EncodeString = part.inlineData.data;
          imageUrl = `data:image/png;base64,${base64EncodeString}`;
          break;
        } 
      }
      
      if (imageUrl) {
        setFlashcardImage(imageUrl);
      } else {
        alert("Failed to generate image. Please try again.");
      }
    } catch (error) {
      console.error("AI Image Generation failed:", error);
      alert(`Image generation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGeneratingFlashcard(false);
    }
  };

  const generateExampleForWord = async (word: SavedWord) => {
    setIsGeneratingExample(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Given the English word "${word.word}" with the definition "${word.englishDefinition}", generate 1 practical, everyday example sentence using this word. Return ONLY the sentence, with no extra text or quotes.`,
      });
      if (response.text) {
        const newExample = response.text.trim();
        const existingExamples = word.customExamples || [];
        if (!existingExamples.includes(newExample)) {
          const updatedExamples = [...existingExamples, newExample];
          updateSavedWordExamples(word.word, updatedExamples.join('\n'));
        }
      }
    } catch (err: any) {
      console.error("Failed to generate example", err);
      if (err?.message?.includes('Quota exceeded')) {
        alert("The AI service quota is exceeded for today. Please try again tomorrow.");
      } else {
        alert("Network or AI service timeout generating example. Please try again.");
      }
    } finally {
      setIsGeneratingExample(false);
    }
  };

  const generateTagsForWord = async (word: SavedWord) => {
    setIsGeneratingTags(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Given the English word "${word.word}" with the definition "${word.englishDefinition}", generate 3 to 5 relevant category tags (e.g., travel, business, academic, emotion, science, daily life). Return ONLY a comma-separated list of these tags, in lowercase, with no extra text or quotes.`,
      });
      if (response.text) {
        const newTags = response.text.trim();
        const existingTagsStr = word.tags?.join(', ') || '';
        const combinedTagsStr = existingTagsStr ? `${existingTagsStr}, ${newTags}` : newTags;
        const uniqueTags = Array.from(new Set(combinedTagsStr.split(',').map(t => t.trim().toLowerCase()).filter(t => t)));
        updateSavedWordTags(word.word, uniqueTags.join(', '));
      }
    } catch (err: any) {
      console.error("Failed to generate tags", err);
      if (err?.message?.includes('Quota exceeded')) {
        alert("The AI service quota is exceeded for today. Please try again tomorrow.");
      } else {
        alert("Network or AI service timeout generating tags. Please try again.");
      }
    } finally {
      setIsGeneratingTags(false);
    }
  };

  const isCurrentWordSaved = result ? savedWords.some(w => w.word.toLowerCase() === result.word.toLowerCase()) : false;

  const processReview = (word: SavedWord, rating: 'Again' | 'Hard' | 'Good' | 'Easy'): SavedWord => {
    if (!word.srs) return word;

    const srs = word.srs;
    let { interval, easeFactor, repetitions } = srs;
    let quality = 0;

    switch (rating) {
      case 'Again': quality = 0; break;
      case 'Hard': quality = 3; break;
      case 'Good': quality = 4; break;
      case 'Easy': quality = 5; break;
    }

    if (quality < 3) {
      repetitions = 0;
      interval = srsSettings.baseInterval;
    } else {
      if (repetitions === 0) {
        interval = srsSettings.baseInterval;
      } else if (repetitions === 1) {
        interval = srsSettings.secondInterval;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions += 1;
    }

    easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + interval);

    const updatedWord: SavedWord = {
      ...word,
      srs: {
        nextReviewDate: nextReviewDate.toISOString(),
        interval,
        easeFactor,
        repetitions
      }
    };

    setSavedWords(prev => prev.map(w => w.word === updatedWord.word ? updatedWord : w));

    const today = new Date().toDateString();
    setUserStats(prev => {
      let newStreak = prev.currentStreak || 0;
      let newTodayReviews = prev.todayReviews || 0;
      let history = [...(prev.learningHistory || [])];
      const todayIs = new Date().toISOString().split('T')[0];
      
      const hIdx = history.findIndex(h => h.date === todayIs);
      if (hIdx >= 0) {
        history[hIdx].reviewsCompleted += 1;
      } else {
        history.push({ date: todayIs, wordsLearned: 0, reviewsCompleted: 1 });
      }

      if (prev.lastReviewDate !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (prev.lastReviewDate === yesterday.toDateString()) {
          newStreak += 1;
        } else {
          newStreak = 1;
        }
        newTodayReviews = 0;
      }

      const isLearned = interval > srsSettings.learnedThreshold;
      const wasLearned = srs.interval > srsSettings.learnedThreshold;
      
      const updatedTodayReviews = newTodayReviews + 1;
      
      // Trigger confetti if goal is exactly met
      if (updatedTodayReviews === prev.dailyGoal) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#10B981', '#3B82F6', '#F59E0B']
        });
      }

      return {
        ...prev,
        totalReviews: prev.totalReviews + 1,
        correctReviews: prev.correctReviews + (quality >= 3 ? 1 : 0),
        currentStreak: newStreak,
        lastReviewDate: today,
        todayReviews: updatedTodayReviews,
        wordsLearned: prev.wordsLearned + (isLearned && !wasLearned ? 1 : (!isLearned && wasLearned ? -1 : 0)),
        learningHistory: history.slice(-14)
      };
    });

    if (!navigator.onLine) {
      localStorage.setItem('learnEnglishEasy_pendingSync', 'true');
      setPendingSync(true);
    }

    return updatedWord;
  };

  const handleReview = (rating: 'Again' | 'Hard' | 'Good' | 'Easy') => {
    if (!currentReviewWord || !currentReviewWord.srs) return;

    processReview(currentReviewWord, rating);

    const newQueue = reviewQueue.slice(1);
    setReviewQueue(newQueue);
    setUserAudioUrl(null);
    if (newQueue.length > 0) {
      setCurrentReviewWord(newQueue[0]);
      setReviewMode('front');
      setReviewGuess('');
    } else {
      setReviewMode('none');
      setCurrentReviewWord(null);
    }
  };

  const handleNextFlashcard = () => {
    if (reviewQueue.length <= 1) return;
    const current = reviewQueue[0];
    const newQueue = [...reviewQueue.slice(1), current];
    setReviewQueue(newQueue);
    setUserAudioUrl(null);
    setCurrentReviewWord(newQueue[0]);
    setReviewMode('front');
    setReviewGuess('');
  };

  const handlePrevFlashcard = () => {
    if (reviewQueue.length <= 1) return;
    const last = reviewQueue[reviewQueue.length - 1];
    const newQueue = [last, ...reviewQueue.slice(0, -1)];
    setReviewQueue(newQueue);
    setUserAudioUrl(null);
    setCurrentReviewWord(newQueue[0]);
    setReviewMode('front');
    setReviewGuess('');
  };

  const handleManualReview = (rating: 'Again' | 'Hard' | 'Good' | 'Easy') => {
    if (!result) return;
    const savedWord = savedWords.find(w => w.word.toLowerCase() === result.word.toLowerCase());
    if (savedWord) {
      processReview(savedWord, rating);
    }
  };

  const generateQuiz = () => {
    if (savedWords.length < 4) {
      alert("You need to save at least 4 words to play the vocabulary quiz!");
      return;
    }
    
    const questions: any[] = [];
    
    // Prioritize more recently saved words and lower SRS ease factors
    const scoredWords = [...savedWords].map((word, index) => {
      // index 0 is the most recent. normalized to 0.0 -> 1.0
      const recencyScore = index / savedWords.length; 
      // Lower ease factor means it's harder, so we want it to have a lower score to appear first
      const easeScore = word.srs?.easeFactor || 2.5;
      // Combine with some randomness
      const finalScore = easeScore + (recencyScore * 1.5) + (Math.random() * 0.5);
      
      return { word, finalScore };
    });

    const wordsToUse = scoredWords.sort((a, b) => a.finalScore - b.finalScore).slice(0, quizSettings.questionCount).map(w => w.word);
    
    const availableTypes: number[] = [];
    if (quizSettings.types.meaning) availableTypes.push(0);
    if (quizSettings.types.pronunciation) availableTypes.push(1);
    if (quizSettings.types.example) availableTypes.push(2);
    if (availableTypes.length === 0) availableTypes.push(0); // Fallback

    wordsToUse.forEach(word => {
      const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
      
      const allOtherWords = savedWords.filter(w => w.word !== word.word).map(w => w);
      const distractors = [...allOtherWords].sort(() => Math.random() - 0.5).slice(0, 3);
      
      let typeToUse = type;
      const hasExamples = (word.examples && word.examples.length > 0) || (word.exampleSentences && word.exampleSentences.length > 0) || !!word.exampleSentence;
      if (typeToUse === 2 && !hasExamples) typeToUse = 0;
      if (typeToUse === 1 && !word.phonetic) typeToUse = 0;
      
      let questionText = '';
      let correctAnswer = '';
      let options: string[] = [];
      
      if (typeToUse === 0) {
        questionText = `What is the meaning of "${word.word}"?`;
        correctAnswer = word.bengaliMeaning || word.englishDefinition || 'Meaning not found';
        options = distractors.map(d => d.bengaliMeaning || d.englishDefinition || 'Meaning not found');
      } else if (typeToUse === 1) {
        questionText = `Which word matches this pronunciation: ${word.phonetic}?`;
        correctAnswer = word.word;
        options = distractors.map(d => d.word);
      } else {
        const sentence = word.examples && word.examples.length > 0 
          ? word.examples[0].english 
          : (word.exampleSentences && word.exampleSentences.length > 0 ? word.exampleSentences[0] : word.exampleSentence || "");
        const rawBlanked = sentence.replace(new RegExp(`\\b${word.word}\\b`, 'gi'), "_____");
        questionText = `Complete the sentence: "${rawBlanked}"`;
        correctAnswer = word.word;
        options = distractors.map(d => d.word);
      }
      
      options.push(correctAnswer);
      options = options.sort(() => Math.random() - 0.5);
      
      questions.push({
        wordObj: word,
        questionText,
        correctAnswer,
        options,
        type
      });
    });
    
    setQuizQuestions(questions);
    setCurrentQuizIndex(0);
    setQuizScore(0);
    setSelectedAnswer(null);
    setQuizTimeLeft(quizSettings.timeLimitSeconds > 0 ? quizSettings.timeLimitSeconds : null);
    setQuizState('playing');
  };

  const handleQuizAnswer = React.useCallback((answer: string) => {
    if (selectedAnswer !== null) return;
    
    setSelectedAnswer(answer);
    if (answer === quizQuestions[currentQuizIndex].correctAnswer) {
      setQuizScore(prev => prev + 1);
    }
    
    setTimeout(() => {
      if (currentQuizIndex < quizQuestions.length - 1) {
        setCurrentQuizIndex(prev => prev + 1);
        setSelectedAnswer(null);
        setQuizTimeLeft(quizSettings.timeLimitSeconds > 0 ? quizSettings.timeLimitSeconds : null);
      } else {
        setQuizState('finished');
      }
    }, 1500);
  }, [selectedAnswer, quizQuestions, currentQuizIndex, quizSettings.timeLimitSeconds]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (quizState === 'playing' && quizTimeLeft !== null && quizTimeLeft > 0 && selectedAnswer === null) {
      timer = setTimeout(() => setQuizTimeLeft(prev => prev! - 1), 1000);
    } else if (quizState === 'playing' && quizTimeLeft === 0 && selectedAnswer === null) {
      handleQuizAnswer("TIME_OUT_NO_ANSWER");
    }
    return () => clearTimeout(timer);
  }, [quizTimeLeft, quizState, selectedAnswer, handleQuizAnswer]);

  const handleTranslation = async () => {
    if (!translationInput.trim()) return;
    setIsTranslating(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Translate the following text. If the input is in English, translate it to Bengali. If the input is in Bengali, translate it to English. Output only the translated text, nothing else. Text: "${translationInput}"`
      });
      if (response.text) {
        setTranslationOutput(response.text.trim());
      }
    } catch (e: any) {
      console.error("Translation failed", e);
      if (e?.message?.includes('Quota exceeded')) {
        setTranslationOutput("The AI service has reached its daily request limit. Please try again tomorrow.");
      } else {
        setTranslationOutput("Translation request timed out or failed. Please check your internet connection and try again.");
      }
    } finally {
      setIsTranslating(false);
    }
  };

  const playTranslationAudio = (text: string) => {
    const isBengali = /[\u0980-\u09FF]/.test(text);
    if (isBengali) {
      playBengaliPronunciation(text);
    } else {
      playPronunciation(text);
    }
  };

  const startReview = () => {
    const now = new Date();
    const dueWords = savedWords.filter(w => w.srs && new Date(w.srs.nextReviewDate) <= now);
    const shuffled = [...dueWords].sort(() => Math.random() - 0.5);
    
    setReviewQueue(shuffled);
    setUserAudioUrl(null);
    if (shuffled.length > 0) {
      setCurrentReviewWord(shuffled[0]);
      setReviewMode('front');
      setReviewGuess('');
    } else {
      alert("No words due for review right now!");
    }
  };

  const startLearnMode = (level?: 'All' | 'Beginner' | 'Intermediate' | 'Advanced') => {
    const filter = level || difficultyFilter;
    const wordsToLearn = filter === 'All' 
      ? savedWords 
      : savedWords.filter(w => w.difficultyLevel && w.difficultyLevel.toLowerCase() === filter.toLowerCase());

    if (wordsToLearn.length === 0) {
      alert(`You haven't saved any ${filter !== 'All' ? filter.toLowerCase() + ' ' : ''}words yet!`);
      return;
    }

    const now = new Date();
    
    // Prioritize words needing review (due words) based on their SRS data, then sort by ease/reps
    const sortedForLearning = [...wordsToLearn].sort((a, b) => {
      const isDueA = a.srs && new Date(a.srs.nextReviewDate) <= now ? 1 : 0;
      const isDueB = b.srs && new Date(b.srs.nextReviewDate) <= now ? 1 : 0;
      
      // If one is due and the other isn't, the due one comes first
      if (isDueA !== isDueB) {
        return isDueB - isDueA;
      }
      
      const scoreA = (a.srs?.repetitions || 0) * (a.srs?.easeFactor || 2.5) + Math.random();
      const scoreB = (b.srs?.repetitions || 0) * (b.srs?.easeFactor || 2.5) + Math.random();
      return scoreA - scoreB;
    }).slice(0, 20); // Practice up to 20 words at a time
    
    setReviewQueue(sortedForLearning);
    setUserAudioUrl(null);
    setCurrentReviewWord(sortedForLearning[0]);
    setReviewMode('front');
    setReviewGuess('');
  };

  const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  const dueWordsCount = savedWords.filter(w => w.srs && new Date(w.srs.nextReviewDate) <= new Date()).length;
  const allTags = Array.from(new Set(savedWords.flatMap(w => w.tags || []))).sort();
  const filteredSavedWords = savedWords.filter(w => 
    (difficultyFilter === 'All' || (w.difficultyLevel && w.difficultyLevel.toLowerCase() === difficultyFilter.toLowerCase())) &&
    (selectedTagFilter === 'All' || (w.tags && w.tags.includes(selectedTagFilter)))
  );

  const glossaryFilteredWords = filteredSavedWords.filter(w => 
    !glossarySearchQuery || w.word.toLowerCase().includes(glossarySearchQuery.toLowerCase())
  );

  return (
    <div className={`min-h-screen flex flex-col w-full overflow-x-hidden transition-colors duration-500 ${isDarkMode ? 'bg-[#0a0a0a] text-gray-100' : 'bg-gradient-to-b from-[#E6F7F2] via-[#F0FDF8] to-[#F8FAFC] text-slate-800'}`}>
      {/* Navbar */}
      <nav className="flex items-center justify-between p-4 md:px-8 md:py-6 max-w-5xl mx-auto w-full relative z-50">
        <div 
          onClick={goHome}
          title="Go to Home"
          className="flex items-center gap-2 sm:gap-3 cursor-pointer transition-transform hover:scale-105 shrink-0"
        >
          <Leaf className={`w-8 h-8 sm:w-10 sm:h-10 ${isDarkMode ? 'text-[#10B981]' : 'text-[#064E3B]'}`} />
        </div>

        {/* Desktop Menu */}
        <div className="hidden md:flex flex-wrap items-center justify-end gap-1 sm:gap-4">
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`relative w-16 h-8 rounded-full flex items-center p-1 cursor-pointer transition-colors duration-500 overflow-hidden ${isDarkMode ? 'bg-slate-700' : 'bg-sky-100 border border-sky-200/50'}`}
            aria-label="Toggle dark mode"
          >
            {/* Track background icons */}
            <div className="absolute inset-0 flex items-center justify-between px-1.5 pointer-events-none">
              <span className={`text-[10px] ${isDarkMode ? 'opacity-50' : 'opacity-100'}`}>⭐</span>
              <span className={`text-[10px] ${isDarkMode ? 'opacity-100' : 'opacity-50'}`}>🌙</span>
            </div>
            
            {/* Sliding thumb */}
            <div className={`relative w-6 h-6 rounded-full shadow-md transition-transform duration-500 z-10 ${isDarkMode ? 'translate-x-8 bg-slate-800 border-2 border-slate-600' : 'translate-x-0 bg-white border-2 border-slate-100'}`}>
            </div>
          </button>
          <button 
            onClick={() => {
              setShowQuiz(!showQuiz);
              if (!showQuiz) {
                setShowHistory(false);
                setShowGlossary(false);
                setShowDashboard(false);
                setShowTranslator(false);
                setShowQuizSettings(false);
                setResult(null);
                setQuizState('start');
              }
            }}
            className={`p-2 transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-100' : 'text-slate-600 hover:text-slate-900'}`}
            title="Vocabulary Quiz - Test your saved words"
          >
            <Gamepad2 className="w-6 h-6" />
          </button>
          <button 
            onClick={() => {
              setShowTranslator(!showTranslator);
              if (!showTranslator) {
                setShowHistory(false);
                setShowGlossary(false);
                setShowDashboard(false);
                setShowQuiz(false);
                setShowQuizSettings(false);
                setResult(null);
              }
            }}
            className={`p-2 transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-100' : 'text-slate-600 hover:text-slate-900'}`}
            title="AI Translator - Translate text and sentences"
          >
            <CustomTranslateIcon className="w-6 h-6" />
          </button>
          <button 
            onClick={() => {
              setShowDashboard(!showDashboard);
              if (!showDashboard) {
                setShowHistory(false);
                setShowGlossary(false);
                setShowTranslator(false);
                setShowQuiz(false);
                setShowQuizSettings(false);
                setResult(null);
              }
            }}
            className={`relative p-2 transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-100' : 'text-slate-600 hover:text-slate-900'}`}
            title="Progress Dashboard - View your learning stats"
          >
            <TrendingUp className="w-6 h-6" />
            {dueWordsCount > 0 && (
              <span className={`absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 ${isDarkMode ? 'border-[#0a0a0a]' : 'border-white'}`}></span>
            )}
          </button>
          <button 
            onClick={() => {
              setShowGlossary(!showGlossary);
              if (!showGlossary) {
                setShowHistory(false);
                setShowDashboard(false);
                setShowTranslator(false);
                setShowQuiz(false);
                setShowQuizSettings(false);
                setResult(null);
              }
            }}
            className={`p-2 transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-100' : 'text-slate-600 hover:text-slate-900'}`}
            title="Glossary - Browse all your saved words"
          >
            <BookOpen className="w-6 h-6" />
          </button>
          <button 
            onClick={() => {
              setShowSettings(true);
            }}
            className={`p-2 transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-100' : 'text-slate-600 hover:text-slate-900'}`}
            title="Settings - Configure app preferences"
          >
            <Settings className="w-6 h-6" />
          </button>
          <button 
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory) {
                setShowGlossary(false);
                setShowDashboard(false);
                setShowTranslator(false);
                setShowQuiz(false);
                setShowQuizSettings(false);
                setResult(null);
              }
            }}
            className={`p-2 transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-100' : 'text-slate-600 hover:text-slate-900'}`}
            title="Search History - View recent words"
          >
            <History className="w-6 h-6" />
          </button>
        </div>

        {/* Mobile Menu Toggle */}
        <div className="flex md:hidden items-center gap-2">
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`relative w-14 h-7 rounded-full flex items-center p-1 cursor-pointer transition-colors duration-500 overflow-hidden ${isDarkMode ? 'bg-slate-700' : 'bg-sky-100 border border-sky-200/50'}`}
            aria-label="Toggle dark mode"
          >
            {/* Track background icons */}
            <div className="absolute inset-0 flex items-center justify-between px-1 pointer-events-none">
              <span className={`text-[10px] ${isDarkMode ? 'opacity-50' : 'opacity-100'}`}>⭐</span>
              <span className={`text-[10px] ${isDarkMode ? 'opacity-100' : 'opacity-50'}`}>🌙</span>
            </div>
            
            {/* Sliding thumb */}
            <div className={`relative w-5 h-5 rounded-full shadow-md transition-transform duration-500 z-10 ${isDarkMode ? 'translate-x-7 bg-slate-800 border-2 border-slate-600' : 'translate-x-0 bg-white border-2 border-slate-100'}`}>
            </div>
          </button>
          <button 
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className={`p-2 rounded-xl transition-colors ${isDarkMode ? 'bg-white/5 text-gray-200 hover:bg-white/10' : 'bg-white shadow-sm text-slate-800 hover:bg-gray-50'}`}
          >
            {showMobileMenu ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Dropdown */}
      <AnimatePresence>
        {showMobileMenu && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={`md:hidden absolute top-[72px] left-4 right-4 z-40 rounded-2xl p-4 shadow-xl border overflow-hidden flex flex-col gap-2 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}
          >
            <button 
              onClick={() => {
                setShowMobileMenu(false);
                setShowQuiz(!showQuiz);
                if (!showQuiz) {
                  setShowHistory(false);
                  setShowGlossary(false);
                  setShowDashboard(false);
                  setShowTranslator(false);
                  setShowQuizSettings(false);
                  setResult(null);
                  setQuizState('start');
                }
              }}
              className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-white/5 text-gray-200' : 'hover:bg-gray-50 text-slate-700'}`}
            >
              <Gamepad2 className="w-5 h-5 text-emerald-500" />
              <span className="font-medium">Vocabulary Quiz</span>
            </button>
            <button 
              onClick={() => {
                setShowMobileMenu(false);
                setShowTranslator(!showTranslator);
                if (!showTranslator) {
                  setShowHistory(false);
                  setShowGlossary(false);
                  setShowDashboard(false);
                  setShowQuiz(false);
                  setShowQuizSettings(false);
                  setResult(null);
                }
              }}
              className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-white/5 text-gray-200' : 'hover:bg-gray-50 text-slate-700'}`}
            >
              <CustomTranslateIcon className="w-5 h-5 text-emerald-500" />
              <span className="font-medium">AI Translator</span>
            </button>
            <button 
              onClick={() => {
                setShowMobileMenu(false);
                setShowDashboard(!showDashboard);
                if (!showDashboard) {
                  setShowHistory(false);
                  setShowGlossary(false);
                  setShowTranslator(false);
                  setShowQuiz(false);
                  setShowQuizSettings(false);
                  setResult(null);
                }
              }}
              className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-white/5 text-gray-200' : 'hover:bg-gray-50 text-slate-700'}`}
            >
              <div className="relative">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                {dueWordsCount > 0 && (
                  <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 ${isDarkMode ? 'border-[#0a0a0a]' : 'border-white'}`}></span>
                )}
              </div>
              <span className="font-medium">Progress Dashboard</span>
            </button>
            <button 
              onClick={() => {
                setShowMobileMenu(false);
                setShowGlossary(!showGlossary);
                if (!showGlossary) {
                  setShowHistory(false);
                  setShowDashboard(false);
                  setShowTranslator(false);
                  setShowQuiz(false);
                  setShowQuizSettings(false);
                  setResult(null);
                }
              }}
              className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-white/5 text-gray-200' : 'hover:bg-gray-50 text-slate-700'}`}
            >
              <BookOpen className="w-5 h-5 text-emerald-500" />
              <span className="font-medium">Glossary</span>
            </button>
            <button 
              onClick={() => {
                setShowMobileMenu(false);
                setShowSettings(true);
              }}
              className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-white/5 text-gray-200' : 'hover:bg-gray-50 text-slate-700'}`}
            >
              <Settings className="w-5 h-5 text-emerald-500" />
              <span className="font-medium">Settings</span>
            </button>
            <button 
              onClick={() => {
                setShowMobileMenu(false);
                setShowHistory(!showHistory);
                if (!showHistory) {
                  setShowGlossary(false);
                  setShowDashboard(false);
                  setShowTranslator(false);
                  setShowQuiz(false);
                  setShowQuizSettings(false);
                  setResult(null);
                }
              }}
              className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-white/5 text-gray-200' : 'hover:bg-gray-50 text-slate-700'}`}
            >
              <History className="w-5 h-5 text-emerald-500" />
              <span className="font-medium">Search History</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Offline Banner */}
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full bg-amber-500 text-white text-center py-2 text-sm font-medium shadow-sm"
          >
            You are currently offline. You can still search for previously cached words.
          </motion.div>
        )}
      </AnimatePresence>

      {/* Study Reminder Banner */}
      <AnimatePresence>
        {showStudyReminder && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`w-full max-w-5xl mx-auto mt-4 px-4 relative z-40`}
          >
            <div className={`p-4 rounded-xl flex flex-col sm:flex-row gap-4 items-center justify-between shadow-sm border-l-4 ${isDarkMode ? 'bg-slate-800/80 border-[#10B981]' : 'bg-white border-[#10B981]'} `}>
              <div className="flex items-center gap-4 text-left w-full sm:w-auto">
                <div className={`p-3 rounded-full shrink-0 ${isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-600'}`}>
                  <Calendar className="w-6 h-6" />
                </div>
                <div>
                  <h3 className={`font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Time for your daily review!</h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>
                    {userStats.dailyReminders === undefined 
                      ? "You have words due. Enable daily reminders to build your learning streak?"
                      : `You have ${dueWordsCount} word${dueWordsCount !== 1 ? 's' : ''} due for review today.`
                    }
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto mt-2 sm:mt-0 justify-end">
                {userStats.dailyReminders === undefined ? (
                  <>
                    <button 
                      onClick={() => {
                         setUserStats(prev => ({...prev, dailyReminders: true}));
                         setShowStudyReminder(false);
                         // Trigger native permission request
                         if ("Notification" in window && Notification.permission === "default") {
                           Notification.requestPermission();
                         }
                      }}
                      className="px-4 py-2 bg-[#10B981] text-white rounded-lg text-sm font-bold hover:bg-emerald-600 transition-colors shadow-sm"
                    >
                      Enable Reminders
                    </button>
                    <button 
                      onClick={() => {
                         setUserStats(prev => ({...prev, dailyReminders: false}));
                         setShowStudyReminder(false);
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${isDarkMode ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-slate-600 hover:bg-gray-200'}`}
                    >
                      No Thanks
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => {
                         setShowStudyReminder(false);
                         setShowDashboard(true);
                         setResult(null);
                         setShowHistory(false);
                         setShowGlossary(false);
                      }}
                      className="px-4 py-2 bg-[#10B981] text-white rounded-lg text-sm font-bold hover:bg-emerald-600 transition-colors shadow-sm"
                    >
                      Study Now
                    </button>
                    <button 
                      onClick={() => {
                         localStorage.setItem('learnEnglishEasy_reminderDismissedDate', new Date().toDateString());
                         setShowStudyReminder(false);
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${isDarkMode ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-slate-600 hover:bg-gray-200'}`}
                    >
                      Dismiss
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {reviewMode !== 'none' && currentReviewWord ? (
        <div className="w-full max-w-2xl mx-auto px-4 py-8 flex-1 flex flex-col items-center justify-center">
          <div className="w-full flex justify-between items-center mb-8">
            <h2 className={`text-2xl font-outfit font-bold ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>
              Reviewing <span className="text-[#10B981]">{reviewQueue.length + 1}</span> words
            </h2>
            <button 
              onClick={() => {
                setReviewMode('none');
                setCurrentReviewWord(null);
                setReviewQueue([]);
                setUserAudioUrl(null);
              }}
              className={`text-sm underline ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Exit Review
            </button>
          </div>

          <div className={`w-full rounded-[2.5rem] shadow-sm border p-8 md:p-12 text-center flex flex-col items-center min-h-[400px] justify-center ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
            <div className="flex items-center justify-center gap-4 mb-4">
              <h3 className={`text-5xl md:text-6xl font-outfit font-extrabold text-3d-sm ${isDarkMode ? 'text-[#10B981]' : 'text-[#10B981]'}`}>
                {currentReviewWord.word}
              </h3>
            </div>

            <div className="flex items-center justify-center gap-2 mb-4">
              {!userAudioUrl && (
                <>
                  <button 
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${isRecording ? 'bg-red-500 text-white border-red-500 animate-pulse' : isDarkMode ? 'bg-white/5 border-white/10 text-red-400 hover:bg-white/10' : 'bg-red-50 border-red-200 text-red-500 hover:bg-red-100'}`}
                    title={isRecording ? "Stop recording" : "Record your pronunciation"}
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => playPronunciation(currentReviewWord.word)}
                    className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${isSpeaking ? 'bg-[#10B981] text-white border-[#10B981]' : isDarkMode ? 'bg-white/5 border-white/10 text-emerald-400 hover:bg-white/10' : 'bg-[#F0FDF8] border-[#BDE8DB] text-[#10B981] hover:bg-[#E6F5F1]'}`}
                    title="Play pronunciation"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {userAudioUrl && (
              <div className={`w-full max-w-md mx-auto mb-6 p-4 rounded-2xl border ${isDarkMode ? 'bg-indigo-950/20 border-indigo-500/20' : 'bg-indigo-50/50 border-indigo-100'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                    <Mic className="w-4 h-4" /> Compare Pronunciation
                  </h4>
                  <button 
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`text-xs font-medium px-2 py-1 rounded-lg transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : isDarkMode ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-white text-slate-600 hover:bg-gray-100 border border-gray-200'}`}
                  >
                    {isRecording ? "Stop" : "Record Again"}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`flex-1 flex items-center justify-between p-3 rounded-xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-100 shadow-sm'}`}>
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>You</span>
                    <button onClick={playRecording} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'bg-sky-900/30 text-sky-400 hover:bg-sky-900/50' : 'bg-sky-50 text-sky-600 hover:bg-sky-100'}`}>
                      <Play className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className={`text-xs font-bold uppercase ${isDarkMode ? 'text-gray-600' : 'text-slate-400'}`}>
                    VS
                  </div>
                  
                  <div className={`flex-1 flex items-center justify-between p-3 rounded-xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-100 shadow-sm'}`}>
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>AI</span>
                    <button onClick={() => playPronunciation(currentReviewWord.word)} className={`p-2 rounded-lg transition-colors ${isSpeaking ? 'bg-[#10B981] text-white' : isDarkMode ? 'bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isAnalyzingAudio && (
                  <div className="mt-4 flex items-center justify-center py-4 bg-indigo-500/10 rounded-xl">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-500 mr-2" />
                    <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">AI is analyzing your pronunciation...</span>
                  </div>
                )}
                {!isAnalyzingAudio && pronunciationScore && (
                  <div className={`mt-5 p-6 rounded-2xl border ${pronunciationScore.isCorrect ? (isDarkMode ? 'bg-emerald-950/40 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200') : (isDarkMode ? 'bg-amber-950/40 border-amber-500/30' : 'bg-amber-50 border-amber-200')} shadow-sm relative overflow-hidden text-left`}>
                    <div className={`absolute top-0 left-0 w-1 h-full ${pronunciationScore.isCorrect ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                    
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-xl ${pronunciationScore.isCorrect ? (isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-200 text-emerald-700') : (isDarkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-200 text-amber-700')}`}>
                            {pronunciationScore.isCorrect ? <CheckCircle className="w-6 h-6" /> : <Info className="w-6 h-6" />}
                          </div>
                          <h4 className={`text-lg md:text-xl font-bold font-outfit ${pronunciationScore.isCorrect ? (isDarkMode ? 'text-emerald-400' : 'text-emerald-700') : (isDarkMode ? 'text-amber-400' : 'text-amber-700')}`}>
                            {pronunciationScore.isCorrect ? "Great Job!" : "Keep Trying!"}
                          </h4>
                        </div>
                        
                        <div className="flex items-baseline gap-1">
                          <span className={`text-3xl font-black font-outfit ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                            {pronunciationScore.score}
                          </span>
                          <span className={`text-sm font-bold ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>%</span>
                        </div>
                      </div>

                      <div className={`w-full h-2.5 rounded-full overflow-hidden ${isDarkMode ? 'bg-black/40' : 'bg-white/60'} shadow-inner`}>
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${pronunciationScore.score}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                          className={`h-full rounded-full ${pronunciationScore.isCorrect ? 'bg-emerald-500' : 'bg-amber-500'} relative`}
                        >
                          <div className="absolute inset-0 bg-white/20 w-full"></div>
                        </motion.div>
                      </div>

                      <div className={`p-4 rounded-xl mt-1 flex flex-col gap-3 ${isDarkMode ? 'bg-white/5' : 'bg-white/60'} backdrop-blur-sm`}>
                        {pronunciationScore.phoneticTranscription && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-emerald-500">You said:</span>
                            <span className={`font-mono text-sm ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>/{pronunciationScore.phoneticTranscription}/</span>
                          </div>
                        )}
                        <p className={`text-sm md:text-base font-medium leading-relaxed ${isDarkMode ? 'text-gray-200' : 'text-slate-800'}`}>
                          {pronunciationScore.feedback}
                        </p>
                        {pronunciationScore.specificTips && pronunciationScore.specificTips.length > 0 && (
                          <div className="mt-2 text-sm">
                            <span className={`font-bold mb-2 block ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>Improvement Tips:</span>
                            <ul className="list-disc pl-5 space-y-1">
                              {pronunciationScore.specificTips.map((tip: string, idx: number) => (
                                <li key={idx} className={isDarkMode ? 'text-gray-300' : 'text-slate-700'}>{tip}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
            
            <div className="relative w-full max-w-5xl mx-auto flex items-center justify-center gap-2 sm:gap-6 mt-8">
              <button 
                onClick={(e) => { e.stopPropagation(); handlePrevFlashcard(); }}
                disabled={reviewQueue.length <= 1}
                className={`p-3 rounded-full transition-all flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${isDarkMode ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-white/80 hover:bg-white text-slate-800 shadow-md'}`}
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              
              <div className="w-full max-w-4xl flex-shrink-0 h-[640px]" style={{ perspective: 1000 }}>
                <motion.div
                  className="w-full h-full relative"
                  initial={false}
                  animate={{ rotateY: reviewMode === 'back' ? 180 : 0 }}
                  transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  {/* Front (English Word) */}
                  <div 
                    className={`absolute w-full h-full rounded-[3rem] shadow-lg border flex flex-col items-center justify-center p-10 md:p-12 bg-gradient-to-br transition-shadow cursor-pointer ${isDarkMode ? 'from-[#1A1A1A] to-[#111] border-white/10 hover:shadow-white/5' : 'from-white to-emerald-50/50 border-emerald-100 hover:shadow-emerald-500/10'}`}
                    style={{ backfaceVisibility: 'hidden' }}
                    onClick={() => reviewMode === 'front' && setReviewMode('back')}
                  >
                  <p className={`text-sm font-bold uppercase tracking-widest mb-2 ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>Review Mode</p>
                  <p className={`text-xs opacity-60 mb-6 ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>Click anywhere to flip</p>
                  
                  <h3 className={`text-5xl md:text-6xl font-black font-outfit mb-4 text-center ${isDarkMode ? 'text-white text-3d-sm' : 'text-slate-800 text-3d-sm'}`}>
                    {currentReviewWord.word}
                  </h3>
                  
                  <div className={`inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-xl shadow-inner border ${isDarkMode ? 'bg-[#212f45]/50 border-indigo-500/30 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}`}>
                    <Volume2 className="w-5 h-5 opacity-70" />
                    <span className="font-mono text-xl font-medium tracking-wider">{currentReviewWord.phonetic}</span>
                  </div>

                  <div onClick={(e) => e.stopPropagation()} className="mb-6 flex flex-col items-center">
                    {flashcardImage ? (
                      <div className={`relative w-48 h-48 sm:w-56 sm:h-56 rounded-2xl overflow-hidden border-4 shadow-lg ${isDarkMode ? 'border-gray-800' : 'border-white'}`}>
                        <Image src={flashcardImage} alt={`Flashcard for ${currentReviewWord.word}`} fill className="object-cover" />
                      </div>
                    ) : (
                      <button 
                        onClick={() => generateFlashcardImage(currentReviewWord?.word, currentReviewWord?.englishDefinition)}
                        disabled={isGeneratingFlashcard}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${isDarkMode ? 'bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 border border-sky-500/30' : 'bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200'} ${isGeneratingFlashcard ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                       {isGeneratingFlashcard ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                       {isGeneratingFlashcard ? 'Generating...' : 'Generate Image'}
                      </button>
                    )}
                  </div>

                  <div className="w-full max-w-sm flex flex-col gap-4 relative z-10" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-col gap-2">
                      <label className={`text-sm font-bold ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Recall Meaning (Optional)</label>
                      <input
                        type="text"
                        value={reviewGuess}
                        onChange={(e) => setReviewGuess(e.target.value)}
                        placeholder="Type meaning..."
                        className={`w-full px-4 py-3 rounded-xl border outline-none transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 text-white focus:border-[#10B981]' : 'bg-white border-gray-200 text-slate-800 focus:border-[#10B981]'}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && reviewMode === 'front') {
                            setReviewMode('back');
                          }
                        }}
                      />
                    </div>
                    
                    <button 
                      onClick={() => reviewMode === 'front' && setReviewMode('back')}
                      className="w-full py-3 bg-[#10B981] text-white rounded-xl font-bold hover:bg-[#059669] transition-colors shadow-lg shadow-emerald-500/20"
                    >
                      Reveal Answer
                    </button>
                  </div>
                </div>

                {/* Back (Meanings) */}
                <div 
                  className={`absolute w-full h-full rounded-[3rem] shadow-lg border flex flex-col p-8 md:p-12 overflow-y-auto overflow-x-hidden ${isDarkMode ? 'bg-gradient-to-br from-[#1A1A1A] to-[#111] border-white/10' : 'bg-gradient-to-br from-[#F8FAFC] to-white border-emerald-100'}`}
                  style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                >
                  <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar space-y-6">
                    <div className={`p-6 rounded-2xl border text-center ${isDarkMode ? 'bg-red-500/10 border-red-500/20' : 'bg-red-50 border-red-100'}`}>
                      <h4 className={`text-xs font-bold uppercase tracking-widest mb-2 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>Bengali Meaning</h4>
                      <p className={`text-3xl font-bold font-outfit ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>{currentReviewWord.bengaliMeaning}</p>
                    </div>

                    <div className={`p-5 rounded-2xl border text-left ${isDarkMode ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-100'}`}>
                      <h4 className={`text-xs font-bold uppercase tracking-widest mb-2 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>English Meaning</h4>
                      <p className={`text-lg font-medium leading-relaxed ${isDarkMode ? 'text-blue-100' : 'text-blue-900'}`}>{currentReviewWord.englishDefinition}</p>
                    </div>
                    
                    {currentReviewWord.examples && currentReviewWord.examples.length > 0 && (
                      <div className="px-2">
                        <h4 className={`text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-1 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                          <Quote className="w-3 h-3" /> Examples
                        </h4>
                        <div className="space-y-3">
                          {currentReviewWord.examples.slice(0, 2).map((ex, idx) => (
                            <div key={idx} className="flex gap-2">
                              <span className={`font-bold text-xs mt-1 shrink-0 ${isDarkMode ? 'text-emerald-500' : 'text-emerald-600'}`}>{idx + 1}.</span>
                              <div className="flex flex-col gap-1 w-full">
                                <p className={`text-sm italic ${isDarkMode ? 'text-emerald-100' : 'text-emerald-900'}`}>
                                  &quot;{highlightWord(ex.english, currentReviewWord.word, isDarkMode)}&quot;
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
            
            <button 
              onClick={(e) => { e.stopPropagation(); handleNextFlashcard(); }}
              disabled={reviewQueue.length <= 1}
              className={`p-3 rounded-full transition-all flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${isDarkMode ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-white/80 hover:bg-white text-slate-800 shadow-md'}`}
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          </div>
            
            {reviewMode === 'back' && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-2xl mx-auto mt-8 relative z-10"
              >
                <p className={`text-sm font-bold text-center mb-4 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>How well did you know this?</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <button onClick={() => handleReview('Again')} className="py-4 rounded-2xl font-bold bg-red-100/80 text-red-700 hover:bg-red-200 hover:-translate-y-1 transition-all active:translate-y-0">Again</button>
                  <button onClick={() => handleReview('Hard')} className="py-4 rounded-2xl font-bold bg-orange-100/80 text-orange-700 hover:bg-orange-200 hover:-translate-y-1 transition-all active:translate-y-0">Hard</button>
                  <button onClick={() => handleReview('Good')} className="py-4 rounded-2xl font-bold bg-green-100/80 text-green-700 hover:bg-green-200 hover:-translate-y-1 transition-all active:translate-y-0">Good</button>
                  <button onClick={() => handleReview('Easy')} className="py-4 rounded-2xl font-bold bg-blue-100/80 text-blue-700 hover:bg-blue-200 hover:-translate-y-1 transition-all active:translate-y-0">Easy</button>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      ) : showTranslator ? (
        <div className="w-full max-w-3xl mx-auto px-4 py-8 flex-1">
          <div className="flex items-center justify-between mb-8">
            <h2 className={`text-3xl font-outfit font-extrabold text-3d-sm ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>
              AI <span className="text-[#10B981]">Translator</span>
            </h2>
            <div className={`p-2 rounded-full border ${isDarkMode ? 'border-white/10 bg-white/5 text-emerald-400' : 'border-emerald-100 bg-emerald-50 text-emerald-600'}`}>
              <CustomTranslateIcon className="w-5 h-5" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Input Side */}
            <div className={`p-6 rounded-[2rem] border flex flex-col ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="flex justify-between items-center mb-4">
                <span className={`text-sm font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Input</span>
                <button 
                  onClick={() => { setTranslationInput(''); setTranslationOutput(''); }}
                  className={`text-xs px-3 py-1 rounded-full transition-colors ${isDarkMode ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  Clear
                </button>
              </div>
              <textarea
                value={translationInput}
                onChange={(e) => setTranslationInput(e.target.value)}
                placeholder="Type English or Bengali text here to instantly translate..."
                className={`w-full flex-1 min-h-[150px] p-4 rounded-xl border text-base focus:ring-2 focus:ring-[#10B981] outline-none resize-none transition-colors ${isDarkMode ? 'bg-black/50 border-white/10 text-white placeholder-gray-600' : 'bg-gray-50 border-gray-200 text-slate-800 placeholder-gray-400'}`}
              />
              <button
                onClick={handleTranslation}
                disabled={isTranslating || !translationInput.trim()}
                className={`w-full mt-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors ${isTranslating || !translationInput.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:-translate-y-0.5'} ${isDarkMode ? 'bg-[#10B981] text-white hover:bg-[#34d399]' : 'bg-[#10B981] text-white hover:bg-[#059669]'}`}
              >
                {isTranslating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CustomTranslateIcon className="w-5 h-5" />}
                {isTranslating ? 'Translating...' : 'Translate'}
              </button>
            </div>
            
            {/* Output Side */}
            <div className={`p-6 rounded-[2rem] border flex flex-col ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="flex justify-between items-center mb-4">
                <span className={`text-sm font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Output</span>
                <button 
                  onClick={() => playTranslationAudio(translationOutput)}
                  disabled={!translationOutput || isTranslating || translationOutput.includes('failed')}
                  className={`p-1.5 rounded-full transition-colors ${!translationOutput || isTranslating || translationOutput.includes('failed') ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode ? 'bg-white/10 text-emerald-400 hover:bg-white/20' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                  title="Listen to translation"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
              </div>
              <div className={`w-full flex-1 min-h-[150px] p-4 rounded-xl border text-lg font-medium transition-colors ${isDarkMode ? 'bg-black/50 border-white/10 text-emerald-100' : 'bg-gray-50 border-gray-200 text-slate-800'} ${isTranslating ? 'animate-pulse' : ''} ${!translationOutput ? 'opacity-50' : ''}`}>
                {translationOutput || "Translation will appear here..."}
              </div>
            </div>
          </div>
        </div>
      ) : showDashboard ? (
        <div className="w-full max-w-3xl mx-auto px-4 py-8 flex-1">
          <div className="flex items-center justify-between mb-8">
            <h2 className={`text-3xl font-outfit font-extrabold text-3d-sm ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>
              Progress <span className="text-[#10B981]">Dashboard</span>
            </h2>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setShowSettings(true)}
                className={`p-2 rounded-full border transition-colors ${isDarkMode ? 'border-white/10 text-gray-400 hover:bg-white/5 hover:text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setShowQuiz(true)}
                className={`p-2 rounded-full border transition-colors ${isDarkMode ? 'border-white/10 text-gray-400 hover:bg-white/5 hover:text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
                title="Play Vocabulary Quiz"
              >
                <Gamepad2 className="w-5 h-5" />
              </button>
              <button 
                onClick={startReview}
                className="bg-[#10B981] text-white px-6 py-2 rounded-full font-bold hover:bg-[#059669] transition-colors flex items-center gap-2"
              >
                Start Review
                {dueWordsCount > 0 && (
                  <span className="bg-white text-[#10B981] text-xs px-2 py-0.5 rounded-full">{dueWordsCount}</span>
                )}
              </button>
            </div>
          </div>

          <div className={`mb-8 p-6 rounded-[2rem] border ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
            <div className="flex justify-between items-center mb-4">
              <h3 className={`font-bold font-outfit ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Daily Goal</h3>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                  {userStats.todayReviews} / {userStats.dailyGoal} words
                </span>
                <button 
                  onClick={() => setShowSettings(true)}
                  className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                  title="Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className={`w-full h-5 rounded-full overflow-hidden relative ${isDarkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
              <motion.div 
                className="h-full bg-[#10B981] flex items-center justify-end px-2"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (userStats.todayReviews / userStats.dailyGoal) * 100)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              >
                {userStats.todayReviews > 0 && (
                  <span className="text-[10px] font-bold text-white shadow-sm">
                    {Math.round(Math.min(100, (userStats.todayReviews / userStats.dailyGoal) * 100))}%
                  </span>
                )}
              </motion.div>
            </div>
            {userStats.todayReviews >= userStats.dailyGoal && (
              <p className="text-[#10B981] text-sm font-bold mt-3 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" /> Goal reached for today! Great job!
              </p>
            )}
          </div>

          <div className={`mb-8 p-6 rounded-[2rem] border ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
            <h3 className={`font-bold font-outfit mb-4 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Learn Mode: Practice by Difficulty</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(['Beginner', 'Intermediate', 'Advanced'] as const).map(level => (
                <button
                  key={level}
                  onClick={() => startLearnMode(level)}
                  className={`py-3 rounded-xl font-bold transition-all text-sm flex flex-col items-center gap-1.5 ${
                    level === 'Beginner' ? (isDarkMode ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50' : 'bg-green-100 text-green-700 hover:bg-green-200') :
                    level === 'Intermediate' ? (isDarkMode ? 'bg-yellow-900/30 text-yellow-400 hover:bg-yellow-900/50' : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200') :
                    (isDarkMode ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50' : 'bg-red-100 text-red-700 hover:bg-red-200')
                  }`}
                >
                  <BookOpen className="w-5 h-5 mb-0.5" />
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
            <div className={`p-6 rounded-[2rem] border text-center ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="text-4xl font-outfit font-extrabold text-[#10B981] mb-2">{savedWords.length}</div>
              <div className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Saved Words</div>
            </div>
            <div className={`p-6 rounded-[2rem] border text-center ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="text-4xl font-outfit font-extrabold text-[#10B981] mb-2">{userStats.wordsLearned}</div>
              <div className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Words Learned</div>
            </div>
            <div className={`p-6 rounded-[2rem] border text-center ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="text-4xl font-outfit font-extrabold text-[#10B981] mb-2">{userStats.totalReviews}</div>
              <div className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Total Reviews Completed</div>
            </div>
            <div className={`p-6 rounded-[2rem] border text-center ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="text-4xl font-outfit font-extrabold text-[#10B981] mb-2">{userStats.correctReviews}</div>
              <div className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Correct Reviews</div>
            </div>
            <div className={`p-6 rounded-[2rem] border text-center ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="text-4xl font-outfit font-extrabold text-[#10B981] mb-2">
                {userStats.totalReviews > 0 ? Math.round((userStats.correctReviews / userStats.totalReviews) * 100) : 0}%
              </div>
              <div className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Accuracy</div>
            </div>
            <div className={`p-6 rounded-[2rem] border text-center ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="text-4xl font-outfit font-extrabold text-[#10B981] mb-2">{userStats.currentStreak}</div>
              <div className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Day Streak</div>
            </div>
          </div>
          
          {(() => {
            // Generate a 14-day padded history
            const historyObj = (userStats.learningHistory || []).reduce((acc, curr) => {
              acc[curr.date] = curr;
              return acc;
            }, {} as Record<string, any>);

            const paddedHistory = [];
            for (let i = 13; i >= 0; i--) {
              const d = new Date();
              d.setDate(d.getDate() - i);
              const dateStr = d.toISOString().split('T')[0];
              
              if (historyObj[dateStr]) {
                paddedHistory.push(historyObj[dateStr]);
              } else {
                paddedHistory.push({
                  date: dateStr,
                  wordsLearned: 0,
                  reviewsCompleted: 0
                });
              }
            }

            return (
              <div className={`rounded-[2.5rem] shadow-sm border p-8 mb-8 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
                <h3 className={`text-xl font-outfit font-bold mb-6 ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>Learning Progress (Last 14 Days)</h3>
                <div className="w-full h-72 text-sm">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={paddedHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#333' : '#eee'} vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke={isDarkMode ? '#888' : '#aaa'} 
                        tick={{ fill: isDarkMode ? '#888' : '#aaa' }} 
                        tickFormatter={(date) => {
                          const parts = date.split('-');
                          if(parts.length === 3) return `${parts[1]}/${parts[2]}`;
                          return date;
                        }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke={isDarkMode ? '#888' : '#aaa'} 
                        tick={{ fill: isDarkMode ? '#888' : '#aaa' }} 
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: isDarkMode ? '#222' : '#fff', borderRadius: '1rem', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        labelStyle={{ color: isDarkMode ? '#ccc' : '#666', fontWeight: 'bold', marginBottom: '4px' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                      <ReferenceLine y={userStats.dailyGoal} label={{ position: 'top', value: `Daily Goal (${userStats.dailyGoal})`, fill: isDarkMode ? '#888' : '#aaa', fontSize: 12 }} stroke={isDarkMode ? '#555' : '#ccc'} strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="wordsLearned" name="New Words Saved" stroke="#3B82F6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey="reviewsCompleted" name="Reviews Completed" stroke="#10B981" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {(() => {
            const tagCounts: Record<string, number> = {};
            savedWords.forEach(word => {
              if (word.tags && word.tags.length > 0) {
                word.tags.forEach(tag => {
                  tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
              }
            });
            const tagData = Object.entries(tagCounts)
              .map(([name, count]) => ({ name, count }))
              .sort((a,b) => b.count - a.count);

            if (tagData.length === 0) return null;

            return (
              <div className={`rounded-[2.5rem] shadow-sm border p-8 mb-8 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
                <h3 className={`text-xl font-outfit font-bold mb-6 ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>Tag Usage</h3>
                <div className="w-full h-72 text-sm">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tagData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#333' : '#eee'} vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        stroke={isDarkMode ? '#888' : '#aaa'} 
                        tick={{ fill: isDarkMode ? '#888' : '#aaa' }} 
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke={isDarkMode ? '#888' : '#aaa'} 
                        tick={{ fill: isDarkMode ? '#888' : '#aaa' }} 
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: isDarkMode ? '#222' : '#fff', borderRadius: '1rem', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        labelStyle={{ color: isDarkMode ? '#ccc' : '#666', fontWeight: 'bold', marginBottom: '4px' }}
                        cursor={{ fill: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}
                      />
                      <Bar dataKey="count" name="Words" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          <div className={`rounded-[2.5rem] shadow-sm border p-8 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
              <div className="flex items-center gap-3">
                <h3 className={`text-xl font-outfit font-bold ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>Saved Words List</h3>
                {savedWords.length > 0 && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isDarkMode ? 'bg-[#10B981]/20 text-[#10B981]' : 'bg-[#10B981]/10 text-[#10B981]'}`}>
                    {filteredSavedWords.length} / {savedWords.length}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={difficultyFilter}
                  onChange={(e) => setDifficultyFilter(e.target.value as any)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold outline-none border transition-colors ${
                    difficultyFilter !== 'All' 
                      ? (isDarkMode ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-400' : 'bg-emerald-50 border-emerald-500 text-emerald-600')
                      : (isDarkMode ? 'bg-[#111] border-white/10 text-white focus:border-[#10B981]' : 'bg-white border-gray-200 text-slate-700 focus:border-[#10B981]')
                  }`}
                >
                  <option value="All">All Levels</option>
                  <option value="Beginner">Beginner</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                </select>
                {allTags.length > 0 && (
                  <select 
                    value={selectedTagFilter}
                    onChange={(e) => setSelectedTagFilter(e.target.value)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold outline-none border transition-colors max-w-[150px] truncate ${
                      selectedTagFilter !== 'All'
                        ? (isDarkMode ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-400' : 'bg-emerald-50 border-emerald-500 text-emerald-600')
                        : (isDarkMode ? 'bg-[#111] border-white/10 text-white focus:border-[#10B981]' : 'bg-white border-gray-200 text-slate-700 focus:border-[#10B981]')
                    }`}
                  >
                    <option value="All">All Tags</option>
                    {allTags.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                {savedWords.length > 0 && (
                  <button 
                    onClick={() => startLearnMode()}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors ${isDarkMode ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                  >
                    <Brain className="w-4 h-4" /> Learn Mode
                  </button>
                )}
              </div>
            </div>
            {savedWords.length === 0 ? (
              <p className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>You haven&apos;t saved any words yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredSavedWords.length === 0 ? (
                  <p className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>No words match your filters.</p>
                ) : (
                  filteredSavedWords.map((word, idx) => {
                    const isDue = word.srs && new Date(word.srs.nextReviewDate) <= new Date();
                    return (
                      <div 
                        key={idx}
                        onClick={() => handleSearch(undefined, word.word)}
                        className={`p-4 rounded-2xl border flex flex-col justify-between cursor-pointer transition-colors ${isDarkMode ? 'border-white/10 hover:border-[#10B981]/50 hover:bg-white/5' : 'border-gray-100 hover:border-[#10B981]/30 hover:bg-[#F0FDF8]'}`}
                      >
                        <div className="flex flex-col gap-3">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <h4 className={`font-bold text-lg ${isDarkMode ? 'text-gray-200' : 'text-slate-800'}`}>{word.word}</h4>
                                {isDue && (
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-100 text-amber-700'}`}>Due</span>
                                )}
                              </div>
                              <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-500' : 'text-slate-500'} line-clamp-1`}>{word.bengaliMeaning}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0 ml-3">
                              {word.difficultyLevel && (
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                  word.difficultyLevel.toLowerCase() === 'beginner' ? (isDarkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700') :
                                  word.difficultyLevel.toLowerCase() === 'intermediate' ? (isDarkMode ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-100 text-yellow-700') :
                                  (isDarkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700')
                                }`}>
                                  {word.difficultyLevel}
                                </span>
                              )}
                              {word.tags && word.tags.length > 0 && (
                                <span className={`text-[10px] font-bold flex items-center gap-1 px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
                                  <Tag className="w-2.5 h-2.5" /> {word.tags.length} {word.tags.length === 1 ? 'Tag' : 'Tags'}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <div className="relative flex flex-col gap-2 mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-white/10">
                            <label className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                              <FileText className="inline w-3 h-3 mr-1" />Notes & Memory Hooks
                            </label>
                            <textarea
                              placeholder="Add personal note..."
                              value={word.notes || ''}
                              onChange={(e) => updateSavedWordNotes(word.word, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className={`w-full text-xs px-3 py-2 rounded-xl border outline-none transition-colors resize-none h-16 ${
                                isDarkMode 
                                  ? 'bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-[#10B981]' 
                                  : 'bg-white border-gray-200 text-slate-800 placeholder:text-slate-400 focus:border-[#10B981]'
                              }`}
                            />
                            {word.customExamples && word.customExamples.length > 0 && (
                              <div className="flex flex-col gap-1 mt-1">
                                {word.customExamples.map((ex, exIdx) => (
                                  <div key={exIdx} className={`text-[11px] flex items-start gap-1 font-medium ${isDarkMode ? 'text-emerald-400/80' : 'text-emerald-600/80'}`}>
                                    <span className="opacity-70">&bull;</span> {ex}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex justify-between items-end mt-3">
                            <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                              Next review: {word.srs ? new Date(word.srs.nextReviewDate).toLocaleDateString() : 'N/A'}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className={`rounded-[2.5rem] shadow-sm border p-8 mt-8 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
            <h3 className={`text-xl font-outfit font-bold mb-6 ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>Offline Access & Sync</h3>
            <p className={`text-sm mb-4 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
              Download words to access them without an internet connection. Your learning progress while offline will automatically sync when you reconnect.
            </p>
            
            <div className="mb-6">
              <h4 className={`text-sm font-bold uppercase tracking-widest mb-3 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                Quick Download Collections
              </h4>
              <div className="flex flex-wrap gap-2">
                {[
                  { name: 'GRE Vocabulary', words: ['abate', 'aberration', 'abhor', 'abstruse', 'accolade', 'acerbic', 'acrimony', 'acumen', 'adamant', 'adroit'] },
                  { name: 'Business Idioms', words: ['synergy', 'leverage', 'paradigm', 'bottleneck', 'benchmark', 'bandwidth', 'deliverable', 'ecosystem', 'holistic', 'ideate'] },
                  { name: 'Emotions', words: ['empathy', 'melancholy', 'euphoria', 'nostalgia', 'apathy', 'compassion', 'remorse', 'elation', 'serenity', 'angst'] },
                  { name: 'Daily Verbs', words: ['accomplish', 'evaluate', 'facilitate', 'generate', 'implement', 'maintain', 'negotiate', 'observe', 'participate', 'resolve'] }
                ].map((category) => (
                  <button
                    key={category.name}
                    onClick={() => {
                        setWordsToDownload(category.words.join(', '));
                    }}
                    disabled={downloadingWords || isOffline}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border ${isDarkMode ? 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300 disabled:opacity-50' : 'bg-gray-50 border-gray-200 hover:bg-gray-100 text-slate-600 disabled:opacity-50'}`}
                  >
                    + {category.name} ({category.words.length})
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                value={wordsToDownload}
                onChange={(e) => setWordsToDownload(e.target.value)}
                placeholder="e.g. ubiquitous, ephemeral, serendipity"
                className={`flex-1 px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#10B981]/50 ${isDarkMode ? 'bg-black/50 border-white/10 text-white placeholder-gray-600' : 'bg-gray-50 border-gray-200 text-slate-800 placeholder-gray-400'}`}
                disabled={downloadingWords || isOffline}
              />
              <button 
                onClick={handleBulkDownload}
                disabled={downloadingWords || isOffline || !wordsToDownload.trim()}
                className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 ${downloadingWords || isOffline || !wordsToDownload.trim() ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#10B981] text-white hover:bg-[#059669] hover:shadow-lg hover:-translate-y-0.5'}`}
              >
                {downloadingWords ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                {downloadingWords ? 'Downloading...' : 'Download'}
              </button>
            </div>
            {downloadingWords && (
              <div className={`w-full rounded-full h-2.5 mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                <div className="bg-[#10B981] h-2.5 rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }}></div>
              </div>
            )}
            
            <div className={`p-4 rounded-xl border flex items-center justify-between mb-8 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-100'}`}>
              <div className="flex items-center gap-3">
                {isOffline ? (
                  <WifiOff className="w-5 h-5 text-amber-500" />
                ) : pendingSync ? (
                  <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
                ) : (
                  <CheckCircle className="w-5 h-5 text-[#10B981]" />
                )}
                <div>
                  <p className={`font-bold ${isDarkMode ? 'text-gray-200' : 'text-slate-700'}`}>
                    {isOffline ? 'Currently Offline' : pendingSync ? 'Syncing Progress...' : 'All Progress Synced'}
                  </p>
                  <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                    {isOffline ? 'Changes will sync when reconnected' : pendingSync ? 'Updating your local data...' : 'Your data is up to date'}
                  </p>
                </div>
              </div>
            </div>

            <div className={`pt-6 border-t ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between mb-4">
                <h4 className={`text-sm font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                  Downloaded Words ({downloadedWordsList.length})
                </h4>
                {downloadedWordsList.length > 0 && (
                  <button 
                    onClick={clearAllDownloadedWords}
                    className="flex items-center gap-2 text-xs font-bold text-red-500 hover:text-red-600 transition-colors bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg"
                  >
                    <Trash2 className="w-3 h-3" /> Clear All
                  </button>
                )}
              </div>
              
              {downloadedWordsList.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {downloadedWordsList.map((word) => (
                    <div key={word} className={`flex items-center justify-between p-2 rounded-lg border ${isDarkMode ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'} transition-colors`}>
                      <span className={`text-sm font-bold truncate ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                        {word}
                      </span>
                      <button 
                        onClick={() => removeDownloadedWord(word)}
                        className={`p-1.5 rounded-md transition-colors ${isDarkMode ? 'text-gray-500 hover:text-red-400 hover:bg-red-500/20' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                        title={`Remove "${word}" from downloads`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`p-4 rounded-xl border text-center ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-100'}`}>
                  <p className={`text-sm italic ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>No words downloaded yet.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : showGlossary ? (
        <div className="w-full max-w-3xl mx-auto px-4 py-8 flex-1">
          <div className="flex items-center justify-between mb-8">
            <h2 className={`text-3xl font-outfit font-extrabold text-3d-sm ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>
              Your <span className="text-[#10B981]">Glossary</span>
            </h2>
            {savedWords.length > 0 && (
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${isDarkMode ? 'bg-[#10B981]/20 text-[#10B981]' : 'bg-[#10B981]/10 text-[#10B981]'}`}>
                {glossaryFilteredWords.length} / {savedWords.length} Words
              </span>
            )}
          </div>

          <div className={`rounded-[2.5rem] shadow-sm border p-8 mb-6 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
            <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
              <div className="relative flex-1">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                <input
                  type="text"
                  placeholder="Search your saved words..."
                  value={glossarySearchQuery}
                  onChange={(e) => setGlossarySearchQuery(e.target.value)}
                  className={`w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none border transition-colors ${isDarkMode ? 'bg-[#222] border-white/10 text-white focus:border-[#10B981]' : 'bg-gray-50 border-gray-200 text-slate-700 focus:border-[#10B981]'}`}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={difficultyFilter}
                  onChange={(e) => setDifficultyFilter(e.target.value as any)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold outline-none border transition-colors ${
                    difficultyFilter !== 'All' 
                      ? (isDarkMode ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-400' : 'bg-emerald-50 border-emerald-500 text-emerald-600')
                      : (isDarkMode ? 'bg-[#222] border-white/10 text-white focus:border-[#10B981]' : 'bg-white border-gray-200 text-slate-700 focus:border-[#10B981]')
                  }`}
                >
                  <option value="All">All Levels</option>
                  <option value="Beginner">Beginner</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                </select>
                {allTags.length > 0 && (
                  <select 
                    value={selectedTagFilter}
                    onChange={(e) => setSelectedTagFilter(e.target.value)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold outline-none border transition-colors max-w-[150px] truncate ${
                      selectedTagFilter !== 'All' 
                        ? (isDarkMode ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-400' : 'bg-emerald-50 border-emerald-500 text-emerald-600')
                        : (isDarkMode ? 'bg-[#222] border-white/10 text-white focus:border-[#10B981]' : 'bg-white border-gray-200 text-slate-700 focus:border-[#10B981]')
                    }`}
                  >
                    <option value="All">All Tags</option>
                    {allTags.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </div>
            </div>

            {savedWords.length === 0 ? (
              <div className="text-center py-8">
                <BookOpen className={`w-12 h-12 mx-auto mb-4 ${isDarkMode ? 'text-gray-600' : 'text-slate-300'}`} />
                <p className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>You haven&apos;t saved any words yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {glossaryFilteredWords.length === 0 ? (
                  <div className="col-span-full text-center py-8">
                    <p className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>No words match your search or filters.</p>
                  </div>
                ) : (
                  glossaryFilteredWords.map((word, idx) => (
                    <div 
                      key={idx}
                      onClick={() => {
                        setShowGlossary(false);
                        handleSearch(undefined, word.word);
                      }}
                      className={`p-4 rounded-2xl border flex flex-col justify-between cursor-pointer transition-all hover:-translate-y-1 ${isDarkMode ? 'border-white/10 hover:border-[#10B981]/50 hover:bg-white/5' : 'border-gray-100 hover:border-[#10B981]/30 hover:bg-white shadow-sm hover:shadow-md'}`}
                    >
                      <div className="flex flex-col flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <h4 className={`font-bold text-lg ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{word.word}</h4>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0 ml-3">
                            {word.difficultyLevel && (
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                word.difficultyLevel.toLowerCase() === 'beginner' ? (isDarkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700') :
                                word.difficultyLevel.toLowerCase() === 'intermediate' ? (isDarkMode ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-100 text-yellow-700') :
                                (isDarkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700')
                              }`}>
                                {word.difficultyLevel}
                              </span>
                            )}
                            {word.tags && word.tags.length > 0 && (
                              <span className={`text-[10px] font-bold flex items-center gap-1 px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
                                <Tag className="w-2.5 h-2.5" /> {word.tags.length} {word.tags.length === 1 ? 'Tag' : 'Tags'}
                              </span>
                            )}
                          </div>
                        </div>
                        {word.englishDefinition && (
                          <p className={`text-sm line-clamp-2 mt-1 mb-2 ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>{word.englishDefinition}</p>
                        )}
                      </div>
                      
                      <div className={`mt-auto pt-3 border-t border-dashed ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                        
                        <div className="relative flex flex-col gap-2">
                          <label className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                            <FileText className="inline w-3 h-3 mr-1" />Notes & Memory Hooks
                          </label>
                          <textarea
                            placeholder="Add personal note..."
                            value={word.notes || ''}
                            onChange={(e) => updateSavedWordNotes(word.word, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className={`w-full text-xs px-3 py-2 rounded-xl border outline-none transition-colors resize-none h-16 ${
                              isDarkMode 
                                ? 'bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-[#10B981]' 
                                : 'bg-gray-50 border-gray-200 text-slate-800 placeholder:text-slate-400 focus:border-[#10B981]'
                            }`}
                          />
                          <div className="flex flex-col gap-2 mt-2">
                            {word.tags && word.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {word.tags.map(tag => (
                                  <span key={tag} className={`text-[10px] font-bold flex items-center gap-1 px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
                                    {tag}
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); removeSavedWordTag(word.word, tag); }} 
                                      className="hover:text-red-500 ml-0.5"
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                            <input
                              type="text"
                              placeholder="Add tag and press Enter"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addSavedWordTag(word.word, e.currentTarget.value);
                                  e.currentTarget.value = '';
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className={`w-full text-xs px-3 py-1.5 rounded-lg border outline-none transition-colors ${
                                isDarkMode 
                                  ? 'bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-indigo-500' 
                                  : 'bg-gray-50 border-gray-200 text-slate-800 placeholder:text-slate-400 focus:border-indigo-500'
                              }`}
                            />
                          </div>
                          {word.customExamples && word.customExamples.length > 0 && (
                            <div className="flex flex-col gap-1 mt-1">
                              {word.customExamples.map((ex, exIdx) => (
                                <div key={exIdx} className={`text-[11px] flex items-start gap-1 font-medium ${isDarkMode ? 'text-emerald-400/80' : 'text-emerald-600/80'}`}>
                                  <span className="opacity-70">&bull;</span> {ex}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      ) : showHistory ? (
        <div className="w-full max-w-2xl mx-auto px-4 py-8 flex-1">
          <div className="flex items-center justify-between mb-8">
            <h2 className={`text-3xl font-outfit font-extrabold text-3d-sm ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>
              Search <span className="text-[#10B981]">History</span>
            </h2>
            {searchHistory.length > 0 && (
              <button 
                onClick={() => setShowClearHistoryDialog(true)}
                className={`flex items-center gap-2 text-sm transition-colors px-4 py-2 rounded-xl font-medium ${isDarkMode ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400' : 'bg-red-50 hover:bg-red-100 text-red-600'}`}
              >
                <Trash2 className="w-4 h-4" /> Clear History
              </button>
            )}
          </div>

          <div className={`rounded-[2.5rem] shadow-sm border p-8 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
            {searchHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-8">
                <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center mb-6 ${isDarkMode ? 'bg-emerald-950/30 text-emerald-500' : 'bg-[#F0FDF8] text-[#10B981]'}`}>
                  <History className="w-10 h-10" />
                </div>
                <p className={`font-medium text-lg ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>No recent searches</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <AnimatePresence mode="popLayout">
                  {searchHistory.map((item, idx) => (
                    <motion.div 
                      key={`${item.word}-${item.date}`}
                      layout
                      initial={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                      transition={{ duration: 0.2 }}
                      tabIndex={0}
                      onClick={() => {
                        setShowHistory(false);
                        handleSearch(undefined, item.word);
                      }}
                      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                        if (e.key === 'Enter') {
                          setShowHistory(false);
                          handleSearch(undefined, item.word);
                        }
                      }}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer group flex justify-between items-center outline-none ${isDarkMode ? 'border-white/10 hover:border-[#10B981]/50 focus:border-[#10B981]/50 hover:bg-white/5 focus:bg-white/5' : 'border-gray-100 hover:border-[#10B981]/30 focus:border-[#10B981]/30 hover:bg-[#F0FDF8] focus:bg-[#F0FDF8]'}`}
                    >
                      <div>
                        <h4 className={`font-bold text-lg transition-colors ${isDarkMode ? 'text-gray-200 group-hover:text-[#10B981] group-focus:text-[#10B981]' : 'text-slate-800 group-hover:text-[#10B981] group-focus:text-[#10B981]'}`}>{item.word}</h4>
                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                          {new Date(item.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSearchHistory(prev => prev.filter(historyItem => historyItem.word !== item.word || historyItem.date !== item.date));
                          }}
                          className={`p-2 rounded-full opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100 transition-all ${isDarkMode ? 'hover:bg-red-500/10 text-red-400' : 'hover:bg-red-50 text-red-500'}`}
                          title="Remove from history"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <ArrowRight className={`w-5 h-5 transition-colors ${isDarkMode ? 'text-gray-600 group-hover:text-[#10B981] group-focus:text-[#10B981]' : 'text-gray-300 group-hover:text-[#10B981] group-focus:text-[#10B981]'}`} />
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      ) : showQuiz ? (
        <div className="w-full max-w-3xl mx-auto px-4 py-8 flex-1">
          <div className="flex items-center justify-between mb-8">
            <h2 className={`text-3xl font-outfit font-extrabold text-3d-sm flex items-center gap-3 ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>
              Vocabulary <span className="text-emerald-500">Quiz</span> 
              <Gamepad2 className="w-8 h-8 text-emerald-500" />
            </h2>
            <button
              onClick={() => {
                setShowQuizSettings(true);
              }}
              className={`p-2 rounded-full border transition-colors flex items-center gap-2 px-4 shadow-sm ${isDarkMode ? 'border-white/10 text-gray-300 hover:bg-white/5 hover:text-white' : 'border-gray-200 text-slate-600 hover:bg-gray-50 hover:text-slate-900'}`}
            >
              <Settings className="w-4 h-4" />
              <span className="text-sm font-bold hidden sm:inline">Quiz Settings</span>
            </button>
          </div>

          <div className={`rounded-[2.5rem] shadow-sm border p-8 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
            {quizState === 'start' && (
              <div className="flex flex-col items-center justify-center text-center py-8">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-emerald-500/20 ${isDarkMode ? 'bg-emerald-950/50' : 'bg-[#F0FDF8]'}`}>
                  <Brain className="w-12 h-12 text-emerald-500" />
                </div>
                <h3 className={`text-2xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Ready to test your knowledge?</h3>
                <p className={`mb-8 max-w-md ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                  Take a {quizSettings.questionCount}-question quiz drawn from your saved words. Tests include meanings, missing words, and pronunciations!
                </p>
                {savedWords.length < 4 && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-xl mb-6 max-w-md w-full text-left flex gap-3 items-start">
                    <span className="text-xl">⚠️</span>
                    <div>
                      <p className="font-bold">Not enough words saved</p>
                      <p className="text-sm opacity-90 mt-1">You need at least 4 saved words to play the Quiz. You currently have {savedWords.length}. Search and save more words!</p>
                    </div>
                  </div>
                )}
                <button 
                  onClick={generateQuiz}
                  disabled={savedWords.length < 4}
                  className={`px-8 py-4 rounded-2xl font-bold flex items-center gap-2 transition-all duration-300 ${
                    savedWords.length < 4 
                      ? (isDarkMode ? 'bg-white/5 text-gray-600 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed') 
                      : 'bg-[#10B981] text-white hover:bg-[#059669] hover:-translate-y-1 hover:shadow-lg hover:shadow-[#10B981]/40'
                  }`}
                >
                  <Play className={`w-5 h-5 ${savedWords.length < 4 ? (isDarkMode ? 'fill-gray-600' : 'fill-gray-400') : 'fill-current'}`} /> Start Quiz
                </button>
              </div>
            )}

            {quizState === 'playing' && quizQuestions.length > 0 && (
              <div className="w-full">
                <div className="flex items-center justify-between mb-8">
                  <span className={`text-sm font-bold ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                    Question {currentQuizIndex + 1} of {quizQuestions.length}
                  </span>
                  {quizTimeLeft !== null && (
                    <span className={`text-xl font-bold flex items-center gap-2 ${quizTimeLeft <= 5 ? 'text-red-500 animate-pulse' : isDarkMode ? 'text-blue-400' : 'text-blue-500'}`}>
                      ⏳ {quizTimeLeft}s
                    </span>
                  )}
                  <span className={`text-sm font-bold ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                    Score: {quizScore}
                  </span>
                </div>
                
                <div className={`w-full rounded-full h-2.5 mb-8 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <div className="bg-[#10B981] h-2.5 rounded-full transition-all duration-500" style={{ width: `${((currentQuizIndex + 1) / quizQuestions.length) * 100}%` }}></div>
                </div>

                <h3 className={`text-2xl font-bold mb-8 text-center leading-relaxed ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                  {quizQuestions[currentQuizIndex].questionText}
                </h3>

                <div className="flex flex-col gap-4">
                  {quizQuestions[currentQuizIndex].options.map((option: string, idx: number) => {
                    const isSelected = selectedAnswer === option;
                    const isCorrect = option === quizQuestions[currentQuizIndex].correctAnswer;
                    const showResult = selectedAnswer !== null;

                    let btnClass = `p-4 rounded-2xl border-2 text-left font-medium transition-all shadow-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-700'} `;
                    if (!showResult) {
                      btnClass += isDarkMode 
                        ? 'bg-white/5 border-white/10 hover:border-emerald-500/50 hover:bg-white/10' 
                        : 'bg-white border-gray-200 hover:shadow-md hover:border-emerald-500/50 hover:bg-emerald-50/30 hover:text-emerald-700';
                    } else if (isCorrect) {
                      btnClass += isDarkMode 
                        ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]' 
                        : 'border-emerald-500 bg-emerald-100 text-emerald-700 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)] font-bold';
                    } else if (isSelected && !isCorrect) {
                      btnClass += isDarkMode 
                        ? 'border-red-500 bg-red-500/20 text-red-300' 
                        : 'border-red-500 bg-red-50 text-red-700 font-bold';
                    } else {
                      btnClass += isDarkMode ? 'border-white/5 bg-transparent opacity-40' : 'bg-gray-50 border-gray-100 opacity-50 text-slate-500';
                    }

                    return (
                      <button 
                        key={idx}
                        onClick={() => handleQuizAnswer(option)}
                        disabled={showResult}
                        className={btnClass}
                      >
                        <span className="flex items-center justify-between">
                          {option}
                          {showResult && isCorrect && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                          {showResult && isSelected && !isCorrect && <X className="w-5 h-5 text-red-500" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {quizState === 'finished' && (
              <div className="flex flex-col items-center justify-center text-center py-8">
                <div className={`w-28 h-28 rounded-full flex items-center justify-center mb-6 shadow-xl ${quizScore > 5 ? 'bg-emerald-500/20 text-emerald-500 shadow-emerald-500/30' : 'bg-amber-500/20 text-amber-500 shadow-amber-500/30'}`}>
                  <span className="text-4xl font-black">{quizScore}/{quizQuestions.length}</span>
                </div>
                <h3 className={`text-3xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                  {quizScore === quizQuestions.length ? 'Perfect Score! 🏆' : quizScore >= quizQuestions.length * 0.7 ? 'Great Job! 🌟' : quizScore >= quizQuestions.length * 0.4 ? 'Good Effort! 👍' : 'Keep Practicing! 💪'}
                </h3>
                <p className={`mb-8 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                  You answered {quizScore} out of {quizQuestions.length} questions correctly.
                </p>
                <div className="flex gap-4">
                  <button 
                    onClick={generateQuiz}
                    className="bg-[#10B981] text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-2 hover:bg-[#059669] hover:-translate-y-1 hover:shadow-lg active:scale-95 transition-all duration-300"
                  >
                    <RefreshCw className="w-5 h-5" /> Play Again
                  </button>
                  <button 
                    onClick={() => {
                      setShowQuiz(false);
                      setShowQuizSettings(false);
                      setQuizState('start');
                    }}
                    className={`px-8 py-4 rounded-2xl font-bold transition-colors ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-200 hover:bg-gray-300 text-slate-800'}`}
                  >
                    Exit Quiz
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Hero Section */}
          {!result && !loading && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center text-center px-4 pt-4 pb-12 w-full max-w-3xl mx-auto"
        >
          <h1 className={`text-5xl md:text-7xl font-outfit font-extrabold mb-6 leading-[1.1] text-3d-sm ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>
            Learn <span className="text-[#10B981]">English</span><br/>Easy
          </h1>
          
          <p className={`max-w-md mx-auto mb-10 text-base md:text-lg ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
            Search any word — get <span className="text-[#10B981] font-medium">Bengali meaning</span>, pronunciation, examples, tips & more. 100% free.
          </p>
          
          {/* Search Bar */}
          <div className="w-full relative" ref={searchContainerRef}>
            <form onSubmit={handleSearch} className={`group w-full rounded-[2rem] shadow-sm p-1 sm:p-2 flex items-center border transition-all duration-300 ease-out z-20 relative focus-within:-translate-y-1 focus-within:scale-[1.01] focus-within:ring-4 focus-within:ring-[#10B981]/20 ${isDarkMode ? 'bg-[#111] border-white/10 focus-within:shadow-[0_8px_30px_rgba(16,185,129,0.15)] focus-within:border-[#10B981]/50' : 'bg-white border-gray-100 focus-within:shadow-[0_8px_30px_rgba(16,185,129,0.15)] focus-within:border-[#10B981]/30'}`}>
              {loading ? (
                <div className={`ml-2 sm:ml-4 shrink-0 p-1.5 rounded-full ${isDarkMode ? 'bg-emerald-900/30' : 'bg-emerald-100'}`}>
                  <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-[#10B981] animate-spin" />
                </div>
              ) : (
                <Search className="w-4 h-4 sm:w-6 sm:h-6 text-gray-400 ml-2 sm:ml-4 shrink-0 transition-colors duration-300 group-focus-within:text-[#10B981]" />
              )}
              <div className="ml-1 sm:ml-3 shrink-0 flex items-center bg-gray-100 dark:bg-white/10 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setSearchMode('en')}
                  className={`px-1.5 sm:px-2 py-1 text-[10px] sm:text-xs font-bold rounded-md transition-colors ${searchMode === 'en' ? 'bg-white text-emerald-600 shadow-sm dark:bg-[#111] dark:text-emerald-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                >
                  EN 
                </button>
                <button
                  type="button"
                  onClick={() => setSearchMode('bn')}
                  className={`px-1.5 sm:px-2 py-1 text-[10px] sm:text-xs font-bold rounded-md transition-colors ${searchMode === 'bn' ? 'bg-white text-emerald-600 shadow-sm dark:bg-[#111] dark:text-emerald-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                >
                  BN
                </button>
              </div>
              <input 
                type="text"
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => {
                  isTypingRef.current = true;
                  setSearchQuery(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className={`min-w-0 flex-1 w-20 bg-transparent border-none px-2 sm:px-4 py-3 sm:py-4 outline-none text-sm sm:text-lg ${isDarkMode ? 'text-white placeholder-gray-500' : 'text-slate-700 placeholder-gray-400'}`} 
                placeholder={searchMode === 'en' ? "English word..." : "Bengali word..."} 
                maxLength={50}
              />
              {searchQuery.length > 0 && (
                <div className="flex items-center mr-1 sm:mr-2">
                  <span className={`text-xs mr-1 sm:mr-2 hidden md:inline-block ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {searchQuery.length}/50
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      isTypingRef.current = false;
                      setSearchQuery('');
                      setSuggestions([]);
                      setShowSuggestions(false);
                    }}
                    className={`p-1 sm:p-1.5 rounded-full transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-white/10 hover:text-white' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
                    title="Clear search"
                  >
                    <X className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              )}
              <button 
                type="button" 
                onClick={toggleListening}
                className={`p-1.5 sm:p-3 mr-1 sm:mr-2 rounded-full transition-colors shrink-0 ${isListening ? 'bg-red-100 text-red-500 animate-pulse' : (isDarkMode ? 'text-gray-400 hover:bg-white/10' : 'text-gray-400 hover:bg-gray-100')}`}
                title={isListening ? "Stop listening" : "Search by voice"}
              >
                <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button 
                type="submit"
                disabled={!searchQuery.trim() || loading}
                className="bg-[#10B981] text-white p-2 sm:px-8 sm:py-4 rounded-xl sm:rounded-2xl font-bold flex items-center justify-center shrink-0 hover:bg-[#059669] hover:-translate-y-1 hover:shadow-lg hover:shadow-[#10B981]/40 transition-all duration-300 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-md disabled:hover:shadow-emerald-500/20 shadow-md shadow-emerald-500/20"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> 
                    <span className="hidden sm:inline-block ml-2">Searching</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 sm:w-5 sm:h-5" /> 
                    <span className="hidden sm:inline-block ml-2">Discover</span>
                  </>
                )}
              </button>
            </form>

            <AnimatePresence>
              {showSuggestions && (suggestions.length > 0 || suggestionsLoading) && !error && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`absolute top-full left-0 right-0 mt-2 rounded-2xl border shadow-xl overflow-hidden z-20 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}
                >
                  {suggestionsLoading && (
                    <div className={`px-6 py-4 flex items-center gap-3 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                      <Loader2 className="w-4 h-4 animate-spin text-[#10B981]" />
                      <span className="text-sm">Fetching suggestions...</span>
                    </div>
                  )}
                  {suggestions.map((sug, idx) => (
                    <motion.div 
                      key={idx}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSearch(undefined, sug.word)}
                      className={`px-6 py-4 cursor-pointer flex flex-col gap-1 transition-colors ${idx === selectedSuggestionIndex ? (isDarkMode ? 'bg-white/10' : 'bg-[#D1F4E6]/50') : ''} ${isDarkMode ? 'hover:bg-white/5 text-gray-200' : 'hover:bg-[#F0FDF8] text-slate-700'}`}
                    >
                      <div className="flex items-center gap-3">
                        <Search className={`w-4 h-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                        <span className="font-medium">{sug.word}</span>
                        {sug.category && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${isDarkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                            {sug.category}
                          </span>
                        )}
                        {sug.isSaved && (
                          <span className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${isDarkMode ? 'bg-emerald-900/30 text-emerald-400' : 'bg-[#D1F4E6] text-[#10B981]'}`}>
                            <Bookmark className="w-3 h-3" /> Saved
                          </span>
                        )}
                      </div>
                      {sug.definition && (
                        <span className={`text-sm pl-7 line-clamp-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {sug.definition}
                        </span>
                      )}
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {transcriptionFeedback && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`absolute top-full left-0 right-0 mt-2 p-5 rounded-2xl border shadow-xl z-20 flex flex-col gap-3 ${isDarkMode ? 'bg-indigo-950/90 border-indigo-500/30 backdrop-blur-md' : 'bg-indigo-50/90 border-indigo-200 backdrop-blur-md'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl ${isDarkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-200 text-indigo-700'}`}>
                        <Mic className="w-5 h-5" />
                      </div>
                      <div>
                        <p className={`text-sm font-bold ${isDarkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>
                          {transcriptionFeedback.confidence === 'low' ? "Not completely sure we got that right." : "Here's what we heard."}
                        </p>
                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-indigo-400/80' : 'text-indigo-600/80'}`}>
                          You can edit the text above or press <Search className="inline w-3 h-3 mx-0.5" /> Search to continue.
                        </p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setTranscriptionFeedback(null)} className={`p-1 mt-1 shrink-0 rounded-full ${isDarkMode ? 'hover:bg-indigo-400/20 text-indigo-300' : 'hover:bg-indigo-200 text-indigo-700'}`}>
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  {transcriptionFeedback.alternatives && transcriptionFeedback.alternatives.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mt-2 pt-3 border-t border-indigo-500/20">
                      <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>Did you mean:</span>
                      {transcriptionFeedback.alternatives.map((alt, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSearchQuery(alt);
                            setTranscriptionFeedback(null);
                            handleSearch(undefined, alt);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-sm font-bold shadow-sm transition-colors border ${isDarkMode ? 'bg-indigo-900 border-indigo-700 text-indigo-100 hover:bg-indigo-800' : 'bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-100'}`}
                        >
                          {alt}
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          {/* Try Pills */}
          <div className="mt-10 flex flex-wrap justify-center gap-3 max-w-2xl">
            <span className="text-gray-400 text-sm font-semibold mr-2 self-center tracking-wider">TRY:</span>
            {TRY_WORDS.map(word => (
              <button 
                key={word} 
                onClick={() => handleSearch(undefined, word)}
                className={`px-5 py-2 rounded-full border text-sm font-medium transition-colors ${isDarkMode ? 'border-white/10 text-emerald-400 bg-white/5 hover:bg-white/10' : 'border-[#BDE8DB] text-[#10B981] bg-[#F0FDF8] hover:bg-[#E6F5F1]'}`}
              >
                {word}
              </button>
            ))}
          </div>
          
          {/* Quick Actions Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-12 w-full text-left">
            <div 
              onClick={() => {
                setShowTranslator(true);
                setShowDashboard(false);
                setShowGlossary(false);
                setShowHistory(false);
                setShowQuiz(false);
                setShowQuizSettings(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`p-6 rounded-3xl border cursor-pointer group transition-all hover:-translate-y-1 hover:shadow-xl ${isDarkMode ? 'bg-gradient-to-br from-[#111] to-[#0A0A0A] border-white/10 hover:border-indigo-500/50 shadow-indigo-500/10' : 'bg-white border-gray-100 hover:border-indigo-300 shadow-indigo-100/50'}`}
            >
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${isDarkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
                <CustomTranslateIcon className="w-6 h-6" />
              </div>
              <h3 className={`text-xl font-bold font-outfit mb-2 group-hover:text-indigo-500 transition-colors ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Language Translator</h3>
              <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Translate full sentences between English and Bengali using Google AI.</p>
            </div>
            
            <div 
              onClick={() => {
                setShowQuiz(true);
                setShowDashboard(false);
                setShowGlossary(false);
                setShowHistory(false);
                setShowTranslator(false);
                setShowQuizSettings(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`p-6 rounded-3xl border cursor-pointer group transition-all hover:-translate-y-1 hover:shadow-xl ${isDarkMode ? 'bg-gradient-to-br from-[#111] to-[#0A0A0A] border-white/10 hover:border-emerald-500/50 shadow-emerald-500/10' : 'bg-white border-gray-100 hover:border-emerald-300 shadow-emerald-100/50'}`}
            >
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                <Gamepad2 className="w-6 h-6" />
              </div>
              <h3 className={`text-xl font-bold font-outfit mb-2 group-hover:text-emerald-500 transition-colors ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Vocabulary Quiz</h3>
              <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Test your knowledge and practice your saved words with our interactive quiz.</p>
            </div>
          </div>

          {/* Word of the Day Widget */}
          <div className="w-full mt-16 text-left">
            <div className="flex items-center gap-3 mb-6">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-emerald-950/30 text-emerald-500' : 'bg-[#D1F4E6] text-[#10B981]'}`}>
                <Sun className="w-5 h-5" />
              </div>
              <h2 className={`text-2xl font-outfit font-bold text-3d-sm ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>Word of the <span className="text-[#10B981]">Day</span></h2>
            </div>

            {wotdLoading ? (
              <div className={`w-full h-48 rounded-[2.5rem] border animate-pulse ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}></div>
            ) : wotd ? (
              <div 
                onClick={() => handleSearch(undefined, wotd.word)}
                className={`w-full relative overflow-hidden rounded-[2.5rem] border p-8 transition-all hover:-translate-y-1 cursor-pointer group ${isDarkMode ? 'bg-gradient-to-br from-[#111] to-[#0A0A0A] border-white/10 hover:border-[#10B981]/50 hover:shadow-[0_8px_30px_rgb(16,185,129,0.1)]' : 'bg-white border-gray-100 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:border-[#10B981]/30'}`}
              >
                {/* Decorative Elements */}
                <div className={`absolute top-0 right-0 w-64 h-64 rounded-full mix-blend-multiply filter blur-3xl opacity-30 pointer-events-none translate-x-1/2 -translate-y-1/2 transition-transform duration-700 group-hover:scale-110 ${isDarkMode ? 'bg-emerald-500' : 'bg-emerald-200'}`} />
                <div className={`absolute bottom-0 left-0 w-64 h-64 rounded-full mix-blend-multiply filter blur-3xl opacity-30 pointer-events-none -translate-x-1/2 translate-y-1/2 transition-transform duration-700 group-hover:scale-110 ${isDarkMode ? 'bg-blue-500' : 'bg-emerald-100'}`} />

                <div className="flex flex-col gap-6 relative z-10 w-full">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black tracking-widest uppercase mb-4 shadow-sm ${isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700 border border-emerald-100/50'}`}>
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} • WORD OF THE DAY
                      </div>
                      <h3 className={`text-4xl sm:text-5xl md:text-6xl font-outfit uppercase tracking-wider mb-2 transition-transform duration-300 group-hover:scale-[1.02] origin-left ${isDarkMode ? 'text-[#10B981] text-3d-sm filter drop-shadow-md' : 'text-[#10B981] text-3d-sm'}`}>
                        {wotd.word}
                      </h3>
                      <p className={`text-xl sm:text-2xl font-bold mt-2 font-serif italic ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                        {wotd.bengaliMeaning}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={handleShareWotd}
                          className={`p-3 sm:p-4 rounded-full transition-all hover:scale-105 shadow-sm ${isDarkMode ? 'bg-white/5 text-gray-400 hover:bg-emerald-500 hover:text-white border border-white/10' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-100/50'}`}
                          title="Share Word of the Day"
                        >
                          <Share2 className="w-5 h-5 sm:w-6 sm:h-6" />
                        </button>
                        <button
                          onClick={(e) => toggleSaveWord(wotd, e)}
                          className={`p-3 sm:p-4 rounded-full transition-all hover:scale-105 shadow-sm ${
                            savedWords.some(w => w.word.toLowerCase() === wotd.word.toLowerCase())
                              ? (isDarkMode ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-emerald-100 text-emerald-700 border border-emerald-200/50')
                              : (isDarkMode ? 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-100/50')
                          }`}
                          title={savedWords.some(w => w.word.toLowerCase() === wotd.word.toLowerCase()) ? "Remove from Vocabulary" : "Save to Vocabulary"}
                        >
                          <Bookmark className={`w-5 h-5 sm:w-6 sm:h-6 ${savedWords.some(w => w.word.toLowerCase() === wotd.word.toLowerCase()) ? 'fill-current' : ''}`} />
                        </button>
                    </div>
                  </div>

                  <div className={`mt-2`}>
                    <p className={`text-lg sm:text-xl font-bold uppercase leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                      {wotd.englishDefinition}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          
          {/* Features Grid */}
          <div className="w-full grid grid-cols-2 gap-4 mt-16">
            <div className={`p-8 rounded-[2rem] border flex flex-col items-center justify-center text-center transition-colors ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="text-5xl font-outfit font-extrabold text-[#10B981] mb-2">∞</div>
              <div className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-400'}`}>Words<br/>Searchable</div>
            </div>
            <div className={`p-8 rounded-[2rem] border flex flex-col items-center justify-center text-center transition-colors ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="text-5xl font-outfit font-extrabold text-[#10B981] mb-2">100%</div>
              <div className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-400'}`}>Free Forever</div>
            </div>
            <div className={`p-8 rounded-[2rem] border flex flex-col items-center justify-center text-center transition-colors ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="text-5xl font-outfit font-extrabold text-[#10B981] mb-2">0</div>
              <div className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-400'}`}>Daily Limits</div>
            </div>
            <div className={`p-8 rounded-[2rem] border flex flex-col items-center justify-center text-center transition-colors ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
              <div className="text-5xl font-outfit font-extrabold text-[#10B981] mb-2">1</div>
              <div className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-gray-400' : 'text-slate-400'}`}>Goal: Fluency</div>
            </div>
          </div>
          
          {/* Feature List */}
          <div className="w-full mt-8 flex flex-col gap-4">
            {Object.values(FEATURES_INFO).map((feature) => (
              <div 
                key={feature.id}
                onClick={() => setSelectedFeatureDetails(feature)}
                className={`p-6 rounded-[2rem] border flex flex-col items-start text-left cursor-pointer group transition-all hover:-translate-y-1 hover:shadow-xl ${isDarkMode ? `bg-[#111] border-white/10 hover:border-${feature.colorClass.replace('text-', '')}/50` : `bg-white border-gray-100 hover:border-${feature.colorClass.replace('text-', '')}/30`}`}
              >
                <div className="flex w-full justify-between items-start mb-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 ${isDarkMode ? feature.darkBgClass + ' ' + feature.darkColorClass : feature.bgClass + ' ' + feature.colorClass}`}>
                    {feature.icon}
                  </div>
                  <div className={`text-xs font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode ? feature.darkColorClass : feature.colorClass}`}>
                    Learn More <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
                <h3 className={`text-xl font-outfit font-extrabold mb-2 ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>{feature.title}</h3>
                <p className={`text-base ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>{feature.whatItDoes[0]}</p>
              </div>
            ))}
          </div>
          
          {/* Footer */}
          <div className="mt-16 mb-8 flex flex-col items-center text-center">
            <div className="flex items-center gap-2 mb-4">
              <Leaf className={`w-6 h-6 ${isDarkMode ? 'text-[#10B981]' : 'text-[#064E3B]'}`} />
              <span className="text-xl font-outfit font-extrabold text-[#10B981] text-3d-sm">Learn English Easy</span>
            </div>
            <p className={`text-sm max-w-sm ${isDarkMode ? 'text-gray-600' : 'text-slate-300'}`}>
              Built with love for every Bengali speaker striving to master the English language.
            </p>
          </div>
        </motion.div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-[#D1F4E6] border-t-[#10B981] rounded-full animate-spin mb-4"></div>
          <p className="text-[#10B981] font-medium animate-pulse">Analyzing word...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="max-w-2xl mx-auto w-full px-4 mt-8">
          <div className="bg-red-50 text-red-600 p-6 rounded-2xl border border-red-100 text-center">
            <p className="mb-4">{error}</p>
            
            {spellSuggestions.length > 0 && (
              <div className="mt-4 pt-4 border-t border-red-200/50">
                <p className="text-sm font-medium mb-3 text-red-800">Did you mean:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {spellSuggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSearch(undefined, suggestion)}
                      className="px-4 py-2 bg-white text-red-700 font-bold text-sm rounded-xl border-2 border-red-200 hover:bg-red-50 hover:border-red-400 transition-colors shadow-sm"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {suggestions.length > 0 && spellSuggestions.length === 0 && (
              <div className="mt-4 pt-4 border-t border-red-200/50">
                <p className="text-sm font-medium mb-3 text-red-800">Did you mean one of these?</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestions.slice(0, 5).map((sug, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSearch(undefined, sug.word)}
                      className="px-3 py-1.5 bg-white text-red-700 text-sm rounded-lg border border-red-200 hover:bg-red-50 hover:border-red-300 transition-colors shadow-sm"
                    >
                      {sug.word}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <button onClick={() => setError('')} className="block mx-auto mt-4 text-sm font-medium underline hover:text-red-800 transition-colors">Try another word</button>
          </div>
        </div>
      )}

      {/* Result / Word of the Day Section */}
      {result && !loading && (
        <motion.div 
          key={result.word}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 100, damping: 15 }}
          className="w-full max-w-2xl mx-auto px-4 py-8"
        >
          {/* Search Bar (Top when result is shown) */}
          <div className="w-full relative mb-12" ref={topSearchContainerRef}>
            <form onSubmit={handleSearch} className={`group w-full rounded-[2rem] shadow-sm p-1 sm:p-2 flex items-center border transition-all duration-300 ease-out z-20 relative focus-within:-translate-y-1 focus-within:scale-[1.01] focus-within:ring-4 focus-within:ring-[#10B981]/20 ${isDarkMode ? 'bg-[#111] border-white/10 focus-within:shadow-[0_8px_30px_rgba(16,185,129,0.15)] focus-within:border-[#10B981]/50' : 'bg-white border-gray-100 focus-within:shadow-[0_8px_30px_rgba(16,185,129,0.15)] focus-within:border-[#10B981]/30'}`}>
              {loading ? (
                <div className={`ml-2 sm:ml-4 shrink-0 p-1 rounded-full ${isDarkMode ? 'bg-emerald-900/30' : 'bg-emerald-100'}`}>
                  <Loader2 className="w-4 h-4 sm:w-5 h-5 text-[#10B981] animate-spin" />
                </div>
              ) : (
                <Search className="w-4 h-4 sm:w-6 sm:h-6 text-gray-400 ml-2 sm:ml-4 shrink-0 transition-colors duration-300 group-focus-within:text-[#10B981]" />
              )}
              <div className="ml-1 sm:ml-3 shrink-0 flex items-center bg-gray-100 dark:bg-white/10 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setSearchMode('en')}
                  className={`px-1.5 sm:px-2 py-1 text-[10px] sm:text-xs font-bold rounded-md transition-colors ${searchMode === 'en' ? 'bg-white text-emerald-600 shadow-sm dark:bg-[#111] dark:text-emerald-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setSearchMode('bn')}
                  className={`px-1.5 sm:px-2 py-1 text-[10px] sm:text-xs font-bold rounded-md transition-colors ${searchMode === 'bn' ? 'bg-white text-emerald-600 shadow-sm dark:bg-[#111] dark:text-emerald-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                >
                  BN
                </button>
              </div>
              <input 
                type="text"
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => {
                  isTypingRef.current = true;
                  setSearchQuery(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className={`min-w-0 flex-1 w-20 bg-transparent border-none px-2 sm:px-4 py-3 outline-none text-sm sm:text-lg ${isDarkMode ? 'text-white placeholder-gray-500' : 'text-slate-700 placeholder-gray-400'}`} 
                placeholder={searchMode === 'en' ? "English word..." : "Bengali word..."} 
                maxLength={50}
              />
              {searchQuery.length > 0 && (
                <div className="flex items-center mr-1 sm:mr-2">
                  <span className={`text-xs mr-2 hidden md:inline-block ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {searchQuery.length}/50
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      isTypingRef.current = false;
                      setSearchQuery('');
                      setSuggestions([]);
                      setShowSuggestions(false);
                    }}
                    className={`p-1 sm:p-1.5 rounded-full transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-white/10 hover:text-white' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
                    title="Clear search"
                  >
                    <X className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              )}
              <button 
                type="button" 
                onClick={toggleListening}
                className={`p-1.5 sm:p-2 mr-1 sm:mr-2 rounded-full transition-colors shrink-0 ${isListening ? 'bg-red-100 text-red-500 animate-pulse' : (isDarkMode ? 'text-gray-400 hover:bg-white/10' : 'text-gray-400 hover:bg-gray-100')}`}
                title={isListening ? "Stop listening" : "Search by voice"}
              >
                <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button 
                type="submit"
                disabled={!searchQuery.trim() || loading}
                className="bg-[#10B981] text-white p-2 sm:px-6 sm:py-3 rounded-xl sm:rounded-2xl font-bold flex items-center justify-center shrink-0 hover:bg-[#059669] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#10B981]/40 transition-all duration-300 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-md disabled:hover:shadow-emerald-500/20 shadow-md shadow-emerald-500/20"
              >
                {loading ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin sm:hidden" /> : <Search className="w-4 h-4 sm:w-5 sm:h-5 sm:hidden" />}
                <span className="hidden sm:inline-block ml-2">{loading ? 'Searching...' : 'Discover'}</span>
              </button>
            </form>

            <AnimatePresence>
              {showSuggestions && (suggestions.length > 0 || suggestionsLoading) && !error && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`absolute top-full left-0 right-0 mt-2 rounded-2xl border shadow-xl overflow-hidden z-20 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}
                >
                  {suggestionsLoading && (
                    <div className={`px-6 py-4 flex items-center gap-3 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                      <Loader2 className="w-4 h-4 animate-spin text-[#10B981]" />
                      <span className="text-sm">Fetching suggestions...</span>
                    </div>
                  )}
                  {suggestions.map((sug, idx) => (
                    <motion.div 
                      key={idx}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSearch(undefined, sug.word)}
                      className={`px-6 py-4 cursor-pointer flex flex-col gap-1 transition-colors ${idx === selectedSuggestionIndex ? (isDarkMode ? 'bg-white/10' : 'bg-[#D1F4E6]/50') : ''} ${isDarkMode ? 'hover:bg-white/5 text-gray-200' : 'hover:bg-[#F0FDF8] text-slate-700'}`}
                    >
                      <div className="flex items-center gap-3">
                        <Search className={`w-4 h-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                        <span className="font-medium">{sug.word}</span>
                        {sug.category && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${isDarkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                            {sug.category}
                          </span>
                        )}
                        {sug.isSaved && (
                          <span className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${isDarkMode ? 'bg-emerald-900/30 text-emerald-400' : 'bg-[#D1F4E6] text-[#10B981]'}`}>
                            <Bookmark className="w-3 h-3" /> Saved
                          </span>
                        )}
                      </div>
                      {sug.definition && (
                        <span className={`text-sm pl-7 line-clamp-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {sug.definition}
                        </span>
                      )}
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {transcriptionFeedback && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`absolute top-full left-0 right-0 mt-2 p-5 rounded-2xl border shadow-xl z-20 flex flex-col gap-3 ${isDarkMode ? 'bg-indigo-950/90 border-indigo-500/30 backdrop-blur-md' : 'bg-indigo-50/90 border-indigo-200 backdrop-blur-md'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl ${isDarkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-200 text-indigo-700'}`}>
                        <Mic className="w-5 h-5" />
                      </div>
                      <div>
                        <p className={`text-sm font-bold ${isDarkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>
                          {transcriptionFeedback.confidence === 'low' ? "Not completely sure we got that right." : "Here's what we heard."}
                        </p>
                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-indigo-400/80' : 'text-indigo-600/80'}`}>
                          You can edit the text above or press <Search className="inline w-3 h-3 mx-0.5" /> Search to continue.
                        </p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setTranscriptionFeedback(null)} className={`p-1 mt-1 shrink-0 rounded-full ${isDarkMode ? 'hover:bg-indigo-400/20 text-indigo-300' : 'hover:bg-indigo-200 text-indigo-700'}`}>
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  {transcriptionFeedback.alternatives && transcriptionFeedback.alternatives.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mt-2 pt-3 border-t border-indigo-500/20">
                      <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>Did you mean:</span>
                      {transcriptionFeedback.alternatives.map((alt, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSearchQuery(alt);
                            setTranscriptionFeedback(null);
                            handleSearch(undefined, alt);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-sm font-bold shadow-sm transition-colors border ${isDarkMode ? 'bg-indigo-900 border-indigo-700 text-indigo-100 hover:bg-indigo-800' : 'bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-100'}`}
                        >
                          {alt}
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-center gap-3 mb-8 relative">
            <div className={`h-px flex-1 ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`}></div>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-emerald-950/30 text-emerald-500' : 'bg-[#D1F4E6] text-[#10B981]'}`}>
              <Search className="w-4 h-4" />
            </div>
            <h2 className={`text-2xl font-outfit font-bold text-3d-sm ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>Dictionary <span className="text-[#10B981]">Result</span></h2>
            <div className={`h-px flex-1 ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`}></div>
          </div>
          
          <button 
            onClick={goHome}
            className={`mb-6 flex items-center gap-2 text-sm font-bold transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
          >
            ← Back to Home
          </button>
          
          <div className={`rounded-[2.5rem] shadow-sm overflow-hidden border ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
            <div className="p-8 md:p-10">
              {result.isMisspelled && (
                <div className={`w-full mb-6 p-4 rounded-2xl flex flex-col gap-3 border ${isDarkMode ? 'bg-amber-950/20 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="flex items-center gap-2">
                    <Info className={`w-5 h-5 shrink-0 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`} />
                    <p className={`text-sm font-medium ${isDarkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                      Showing results for <span className="font-bold">&quot;{result.word}&quot;</span>. The word you searched for might have been misspelled.
                    </p>
                  </div>
                  {result.spellcheckSuggestions && result.spellcheckSuggestions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 lg:ml-7">
                      <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-amber-500/80' : 'text-amber-700/80'}`}>Did you mean:</span>
                      {result.spellcheckSuggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSearch(undefined, suggestion)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${isDarkMode ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-white/60 text-amber-900 border border-amber-200 hover:bg-white shadow-sm'}`}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col md:flex-row justify-between items-start mb-6 gap-6">
                <div className="flex flex-col flex-1">
                  <div className={`mb-4 px-4 py-1.5 w-fit rounded-full text-sm font-bold tracking-wide ${isDarkMode ? 'bg-emerald-950/30 text-emerald-400' : 'bg-[#D1F4E6] text-[#10B981]'}`}>
                    {currentDate}
                  </div>
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-5xl font-outfit font-extrabold text-[#10B981] mb-4 text-3d-sm">{result.word}</h3>
                      <div className="flex flex-wrap items-center gap-3 mb-6">
                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border shadow-sm ${isDarkMode ? 'bg-[#1e293b] border-slate-700 text-emerald-400' : 'bg-slate-50 border-slate-200 text-emerald-600'}`}>
                          <Volume2 className="w-4 h-4 opacity-70" />
                          <span className="font-mono text-base font-medium tracking-wide">{result.phonetic}</span>
                        </div>
                        {result.variations && result.variations.length > 0 && (
                          <div className={`inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-lg border shadow-sm ${isDarkMode ? 'bg-amber-900/20 border-amber-500/20 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                            <span className="text-xs font-bold uppercase tracking-wider opacity-70">Variations:</span>
                            {result.variations.map((v, i) => (
                              <span key={i} className="text-sm font-medium">{v}{i < result.variations!.length - 1 ? ', ' : ''}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!userAudioUrl && (
                      <>
                        <button 
                          onClick={isRecording ? stopRecording : startRecording}
                          className={`px-4 h-12 sm:h-14 rounded-2xl border flex items-center justify-center gap-2 transition-colors font-bold text-sm sm:text-base ${isRecording ? 'bg-red-500 text-white border-red-500 animate-pulse' : isDarkMode ? 'bg-white/5 border-white/10 text-red-500 hover:bg-white/10' : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'}`}
                          title={isRecording ? "Stop recording" : "Record your pronunciation"}
                        >
                          <Mic className="w-5 h-5 sm:w-6 sm:h-6" />
                          {isRecording ? "Stop" : "Practice Pronunciation"}
                        </button>
                        <button 
                          onClick={() => playPronunciation(result.word)}
                          className={`w-12 sm:w-14 h-12 sm:h-14 rounded-2xl border flex items-center justify-center transition-colors ${isSpeaking ? 'bg-[#10B981] text-white border-[#10B981]' : isDarkMode ? 'bg-white/5 border-white/10 text-emerald-400 hover:bg-white/10' : 'bg-[#F0FDF8] border-[#BDE8DB] text-[#10B981] hover:bg-[#E6F5F1]'}`}
                          title="Play pronunciation"
                        >
                          <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-6">
                    <div className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider ${isDarkMode ? 'bg-sky-900/30 text-sky-400' : 'bg-[#E0F2FE] text-[#0284C7]'}`}>
                      {result.partOfSpeech}
                    </div>
                    {result.difficultyLevel && (
                      <div className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider ${
                        result.difficultyLevel === 'Beginner' ? (isDarkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700') :
                        result.difficultyLevel === 'Intermediate' ? (isDarkMode ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-100 text-yellow-700') :
                        (isDarkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700')
                      }`}>
                        {result.difficultyLevel}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {userAudioUrl && (
                <div className={`mb-8 p-5 rounded-3xl border ${isDarkMode ? 'bg-indigo-950/20 border-indigo-500/20' : 'bg-indigo-50/50 border-indigo-100'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                      <Mic className="w-4 h-4" /> Compare Pronunciation
                    </h4>
                    <button 
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`text-xs font-medium px-3 py-1.5 rounded-xl transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : isDarkMode ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-white text-slate-600 hover:bg-gray-100 border border-gray-200 shadow-sm'}`}
                    >
                      {isRecording ? "Stop Recording" : "Record Again"}
                    </button>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className={`flex-1 w-full flex items-center justify-between p-4 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-100 shadow-sm'}`}>
                      <div className="flex flex-col">
                        <span className={`text-xs font-bold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>Your Recording</span>
                        <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Listen back</span>
                      </div>
                      <button onClick={playRecording} className={`p-3 rounded-xl transition-colors ${isDarkMode ? 'bg-sky-900/30 text-sky-400 hover:bg-sky-900/50' : 'bg-sky-50 text-sky-600 hover:bg-sky-100'}`}>
                        <Play className="w-5 h-5" />
                      </button>
                    </div>
                    
                    <div className={`text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-600' : 'text-slate-300'}`}>
                      VS
                    </div>
                    
                    <div className={`flex-1 w-full flex items-center justify-between p-4 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-100 shadow-sm'}`}>
                      <div className="flex flex-col">
                        <span className={`text-xs font-bold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>AI Voice</span>
                        <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Native speaker</span>
                      </div>
                      <button onClick={() => playPronunciation(result.word)} className={`p-3 rounded-xl transition-colors ${isSpeaking ? 'bg-[#10B981] text-white' : isDarkMode ? 'bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                        <Volume2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {isAnalyzingAudio && (
                    <div className="mt-4 flex items-center justify-center py-4 bg-indigo-500/10 rounded-xl">
                      <Loader2 className="w-5 h-5 animate-spin text-indigo-500 mr-2" />
                      <span className={`text-sm font-medium ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>AI is analyzing your pronunciation...</span>
                    </div>
                  )}
                  {!isAnalyzingAudio && pronunciationScore && (
                    <div className={`mt-5 p-6 rounded-2xl border ${pronunciationScore.isCorrect ? (isDarkMode ? 'bg-emerald-950/40 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200') : (isDarkMode ? 'bg-amber-950/40 border-amber-500/30' : 'bg-amber-50 border-amber-200')} shadow-sm relative overflow-hidden text-left`}>
                      <div className={`absolute top-0 left-0 w-1 h-full ${pronunciationScore.isCorrect ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                      
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl ${pronunciationScore.isCorrect ? (isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-200 text-emerald-700') : (isDarkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-200 text-amber-700')}`}>
                              {pronunciationScore.isCorrect ? <CheckCircle className="w-6 h-6" /> : <Info className="w-6 h-6" />}
                            </div>
                            <h4 className={`text-lg md:text-xl font-bold font-outfit ${pronunciationScore.isCorrect ? (isDarkMode ? 'text-emerald-400' : 'text-emerald-700') : (isDarkMode ? 'text-amber-400' : 'text-amber-700')}`}>
                              {pronunciationScore.isCorrect ? "Great Job!" : "Keep Trying!"}
                            </h4>
                          </div>
                          
                          <div className="flex items-baseline gap-1">
                            <span className={`text-3xl font-black font-outfit ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                              {pronunciationScore.score}
                            </span>
                            <span className={`text-sm font-bold ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>%</span>
                          </div>
                        </div>

                        <div className={`w-full h-2.5 rounded-full overflow-hidden ${isDarkMode ? 'bg-black/40' : 'bg-white/60'} shadow-inner`}>
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${pronunciationScore.score}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            className={`h-full rounded-full ${pronunciationScore.isCorrect ? 'bg-emerald-500' : 'bg-amber-500'} relative`}
                          >
                            <div className="absolute inset-0 bg-white/20 w-full"></div>
                          </motion.div>
                        </div>

                        <div className={`p-4 rounded-xl mt-1 flex flex-col gap-3 ${isDarkMode ? 'bg-white/5' : 'bg-white/60'} backdrop-blur-sm`}>
                          {pronunciationScore.phoneticTranscription && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-emerald-500">You said:</span>
                              <span className={`font-mono text-sm ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>/{pronunciationScore.phoneticTranscription}/</span>
                            </div>
                          )}
                          <p className={`text-sm md:text-base font-medium leading-relaxed ${isDarkMode ? 'text-gray-200' : 'text-slate-800'}`}>
                            {pronunciationScore.feedback}
                          </p>
                          {pronunciationScore.specificTips && pronunciationScore.specificTips.length > 0 && (
                            <div className="mt-2 text-sm">
                              <span className={`font-bold mb-2 block ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>Improvement Tips:</span>
                              <ul className="list-disc pl-5 space-y-1">
                                {pronunciationScore.specificTips.map((tip: string, idx: number) => (
                                  <li key={idx} className={isDarkMode ? 'text-gray-300' : 'text-slate-700'}>{tip}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              )}
              
              {/* Visual Flashcard Section */}
              <div className={`rounded-3xl p-6 mb-8 border transition-colors relative overflow-hidden ${isDarkMode ? 'bg-sky-500/5 border-sky-500/20' : 'bg-sky-50 border-sky-100'}`}>
                <div className={`absolute -right-4 -top-4 opacity-5 ${isDarkMode ? 'text-sky-500' : 'text-sky-900'}`}>
                  <ImageIcon className="w-32 h-32" />
                </div>
                <h4 className={`text-sm font-bold uppercase tracking-widest mb-4 flex items-center justify-between relative z-10 ${isDarkMode ? 'text-sky-400' : 'text-sky-600'}`}>
                  <span className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" /> AI Flashcard
                  </span>
                  {!flashcardImage && !isGeneratingFlashcard && (
                    <button 
                      onClick={() => generateFlashcardImage()}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${isDarkMode ? 'bg-sky-500/20 text-sky-300 hover:bg-sky-500/40' : 'bg-sky-200 text-sky-800 hover:bg-sky-300'}`}
                    >
                      Generate Image
                    </button>
                  )}
                </h4>
                <div className="relative z-10">
                  {flashcardImage ? (
                    <div className="flex flex-col items-center">
                      <div className={`relative w-full max-w-lg aspect-square rounded-2xl overflow-hidden border-4 shadow-xl ${isDarkMode ? 'border-gray-800' : 'border-white'}`}>
                        <Image src={flashcardImage} alt={`Flashcard for ${result.word}`} fill className="object-cover" />
                      </div>
                      <p className={`mt-4 text-sm italic opacity-80 ${isDarkMode ? 'text-sky-200' : 'text-sky-800'}`}>
                        A visual representation of &quot;{result.word}&quot;
                      </p>
                    </div>
                  ) : isGeneratingFlashcard ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
                      <p className={`text-sm font-medium ${isDarkMode ? 'text-sky-400' : 'text-sky-600'}`}>Painting a masterpiece...</p>
                    </div>
                  ) : (
                    <div className={`py-8 text-center text-sm ${isDarkMode ? 'text-sky-300/70' : 'text-sky-700/70'}`}>
                      Generate a visual flashcard to help you remember this word!
                    </div>
                  )}
                </div>
              </div>

              {/* Meaning & Definition Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Bengali Meaning */}
                <div className={`rounded-3xl p-6 border transition-colors relative overflow-hidden ${isDarkMode ? 'bg-red-500/5 border-red-500/20' : 'bg-red-50 border-red-100'}`}>
                  <div className={`absolute -right-4 -top-8 opacity-[0.03] text-[10rem] font-black font-serif italic ${isDarkMode ? 'text-red-500' : 'text-red-900'} leading-none pointer-events-none select-none`}>
                    অA
                  </div>
                  <h4 className={`text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2 relative z-10 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                    <span className="font-serif italic font-black text-base leading-none translate-y-[-1px]">অA</span> Bengali Meaning
                  </h4>
                  <div className="flex items-start justify-between gap-4 relative z-10">
                    <div>
                      <p className={`text-3xl md:text-4xl font-black font-outfit ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                        {result.bengaliMeaning}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <CopyButton text={result.bengaliMeaning} isDarkMode={isDarkMode} />
                      </div>
                    </div>
                    <button 
                      onClick={() => playBengaliPronunciation(result.bengaliMeaning)}
                      className={`p-3 rounded-full transition-colors shrink-0 ${isSpeaking ? 'bg-red-500/30 text-red-500 animate-pulse' : (isDarkMode ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-white shadow-sm text-red-500 hover:bg-red-50')}`}
                      title="Listen to Bengali Pronunciation"
                    >
                      <Volume2 className="w-6 h-6" />
                    </button>
                  </div>
                </div>

                {/* English Definition */}
                <div className={`rounded-3xl p-6 border transition-colors relative overflow-hidden ${isDarkMode ? 'bg-blue-500/5 border-blue-500/20' : 'bg-blue-50 border-blue-100'}`}>
                  <div className={`absolute -right-4 -top-4 opacity-5 ${isDarkMode ? 'text-blue-500' : 'text-blue-900'}`}>
                    <BookOpen className="w-32 h-32" />
                  </div>
                  <div className="flex justify-between items-center mb-4">
                    <h4 className={`text-sm font-bold uppercase tracking-widest flex items-center gap-2 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      <BookOpen className="w-4 h-4" /> Simple English Meaning
                    </h4>
                    <button
                      onClick={(e) => { e.stopPropagation(); playPronunciation(result.englishDefinition); }}
                      className={`p-2 rounded-full transition-all shrink-0 ${isSpeaking ? 'animate-pulse' : ''} ${isDarkMode ? 'hover:bg-blue-500/20 text-blue-400' : 'hover:bg-blue-200 text-blue-600'}`}
                      title="Listen to meaning directly"
                    >
                      <Volume2 className="w-5 h-5" />
                    </button>
                  </div>
                  <p className={`text-xl font-medium leading-relaxed relative z-10 ${isDarkMode ? 'text-blue-200' : 'text-blue-900'}`}>
                    {result.englishDefinition}
                  </p>
                  {result.synonyms && result.synonyms.length > 0 && (
                    <div className="relative z-10 mt-6 pt-4 border-t border-blue-500/20">
                      <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${isDarkMode ? 'text-blue-400/70' : 'text-blue-600/70'}`}>Related Synonyms</p>
                      <div className="flex flex-wrap gap-2">
                        {result.synonyms.map((syn, idx) => (
                          <span 
                            key={idx} 
                            onClick={(e) => { e.stopPropagation(); handleSearch(undefined, syn); }}
                            className={`px-3 py-1.5 rounded-lg text-sm font-bold cursor-pointer transition-colors ${isDarkMode ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/40' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
                          >
                            {syn}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Example Card */}
              {result.examples && result.examples.length > 0 ? (
                <div className={`rounded-3xl p-6 mb-4 border relative overflow-hidden ${isDarkMode ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-emerald-50 border-emerald-100'}`}>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03] text-[20rem] leading-none pointer-events-none select-none">
                    🗣️
                  </div>
                  <h4 className={`text-sm font-bold uppercase tracking-widest mb-5 flex items-center gap-2 relative z-10 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                    <Quote className="w-4 h-4" /> Real-life Examples
                  </h4>
                  <div className="space-y-6 relative z-10">
                    {result.examples.map((ex, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className={`font-bold mt-0.5 shrink-0 ${isDarkMode ? 'text-emerald-500' : 'text-emerald-600'}`}>{idx + 1}.</span>
                        <div className="flex flex-col gap-1.5 w-full">
                          {ex.context && <span className={`text-[10px] w-fit font-bold uppercase tracking-wider px-2 py-0.5 rounded-md mb-1 ${isDarkMode ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>{ex.context}</span>}
                          <div className="flex items-start justify-between gap-2">
                            <p className={`italic text-lg leading-relaxed flex-1 ${isDarkMode ? 'text-emerald-100' : 'text-emerald-950'}`}>
                              &quot;{highlightWord(ex.english, result.word, isDarkMode)}&quot;
                            </p>
                            <div className="flex items-center gap-1">
                              <button 
                                onClick={(e) => { e.stopPropagation(); playPronunciation(ex.english); }}
                                className={`p-1.5 rounded-lg transition-all shrink-0 ${isDarkMode ? 'hover:bg-white/10 text-gray-400 hover:text-emerald-400' : 'hover:bg-gray-100 text-slate-400 hover:text-emerald-600'}`}
                                title="Play example"
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                              </button>
                              <CopyButton text={ex.english} isDarkMode={isDarkMode} />
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className={`text-sm font-medium flex-1 ${isDarkMode ? 'text-emerald-400/80' : 'text-emerald-700/80'}`}>
                              {ex.bengali}
                            </p>
                            <div className="flex items-center gap-1">
                              <CopyButton text={ex.bengali} isDarkMode={isDarkMode} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : result.exampleSentences && result.exampleSentences.length > 0 ? (
                <div className={`rounded-3xl p-6 mb-4 border relative overflow-hidden ${isDarkMode ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-emerald-50 border-emerald-100'}`}>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03] text-[20rem] leading-none pointer-events-none select-none">
                    🗣️
                  </div>
                  <div className="flex items-center justify-between mb-5 relative z-10">
                    <h4 className={`text-sm font-bold uppercase tracking-widest flex items-center gap-2 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                      <Quote className="w-4 h-4" /> Real-life Examples
                    </h4>
                    <button 
                      onClick={translateLegacyExamples}
                      disabled={isTranslatingExamples}
                      className={`text-xs px-3 py-1 rounded-full font-medium transition-colors flex items-center gap-1 ${
                        isTranslatingExamples 
                          ? 'opacity-50 cursor-not-allowed bg-emerald-100 text-emerald-500' 
                          : isDarkMode 
                            ? 'bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60' 
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      }`}
                    >
                      {isTranslatingExamples ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" /> Translating...
                        </>
                      ) : (
                        <>Translate to Bengali</>
                      )}
                    </button>
                  </div>
                  <div className="space-y-6">
                    {result.exampleSentences.map((ex, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className={`font-bold mt-0.5 shrink-0 ${isDarkMode ? 'text-emerald-500' : 'text-emerald-600'}`}>{idx + 1}.</span>
                        <div className="flex items-start justify-between gap-2 w-full">
                          <p className={`italic text-lg leading-relaxed flex-1 ${isDarkMode ? 'text-emerald-100' : 'text-emerald-950'}`}>
                            &quot;{highlightWord(ex, result.word, isDarkMode)}&quot;
                          </p>
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={(e) => { e.stopPropagation(); playPronunciation(ex); }}
                              className={`p-1.5 rounded-lg transition-all shrink-0 ${isDarkMode ? 'hover:bg-white/10 text-gray-400 hover:text-emerald-400' : 'hover:bg-gray-100 text-slate-400 hover:text-emerald-600'}`}
                              title="Play example"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                            </button>
                            <CopyButton text={ex} isDarkMode={isDarkMode} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : result.exampleSentence ? (
                <div className={`rounded-3xl p-6 mb-4 border flex flex-col gap-4 ${isDarkMode ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-emerald-50 border-emerald-100'}`}>
                  <div className="flex items-center justify-between">
                    <h4 className={`text-sm font-bold uppercase tracking-widest flex items-center gap-2 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                      <Quote className="w-4 h-4" /> Example
                    </h4>
                    <button 
                      onClick={translateLegacyExamples}
                      disabled={isTranslatingExamples}
                      className={`text-xs px-3 py-1 rounded-full font-medium transition-colors flex items-center gap-1 ${
                        isTranslatingExamples 
                          ? 'opacity-50 cursor-not-allowed bg-emerald-100 text-emerald-500' 
                          : isDarkMode 
                            ? 'bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60' 
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      }`}
                    >
                      {isTranslatingExamples ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" /> Translating...
                        </>
                      ) : (
                        <>Translate to Bengali</>
                      )}
                    </button>
                  </div>
                  <div className="flex items-start justify-between gap-4 w-full">
                    <p className={`italic text-lg leading-relaxed flex-1 ${isDarkMode ? 'text-emerald-100' : 'text-emerald-950'}`}>
                      &quot;{highlightWord(result.exampleSentence, result.word, isDarkMode)}&quot;
                    </p>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={(e) => { e.stopPropagation(); playPronunciation(result.exampleSentence!); }}
                        className={`p-1.5 rounded-lg transition-all shrink-0 ${isDarkMode ? 'hover:bg-white/10 text-gray-400 hover:text-emerald-400' : 'hover:bg-gray-100 text-slate-400 hover:text-emerald-600'}`}
                        title="Play example"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                      <CopyButton text={result.exampleSentence} isDarkMode={isDarkMode} />
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Speaking Tips Section */}
              {(result.speakingTips && result.speakingTips.length > 0) ? (
                <div className={`rounded-3xl p-6 mb-8 border relative overflow-hidden ${isDarkMode ? 'bg-amber-900/10 border-amber-900/30' : 'bg-amber-50 border-amber-100'}`}>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03] text-[20rem] leading-none pointer-events-none select-none">
                    🤺
                  </div>
                  <h4 className={`text-sm font-bold uppercase tracking-widest mb-5 flex items-center gap-2 relative z-10 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                    <MessageCircle className="w-4 h-4" /> Speaking Tips
                  </h4>
                  <div className="flex flex-col gap-3 relative z-10">
                    {result.speakingTips.map((tip, idx) => (
                      <div key={idx} className={`p-4 rounded-xl border flex gap-3 text-left items-start transition-colors ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100 shadow-sm'}`}>
                        <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center font-bold text-xs mt-0.5 ${isDarkMode ? 'bg-amber-900/50 text-amber-400' : 'bg-amber-100 text-amber-600'}`}>{idx + 1}</div>
                        <div className="flex flex-col gap-1 w-full">
                          <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-200' : 'text-slate-700'}`}>{typeof tip === 'string' ? tip : tip.english}</p>
                          {typeof tip !== 'string' && tip.bengali && (
                            <p className={`text-sm font-medium mt-1 ${isDarkMode ? 'text-amber-400/80' : 'text-amber-700/80'}`}>{tip.bengali}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : result.dailySpeakingTip && (
                <div className={`rounded-3xl p-6 mb-8 border flex gap-4 ${isDarkMode ? 'bg-amber-950/20 border-amber-500/20' : 'bg-amber-50 border-amber-100'}`}>
                  <Lightbulb className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
                  <p className={`text-base leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>
                    <strong className="text-amber-500">Pro tip:</strong> {result.dailySpeakingTip}
                  </p>
                </div>
              )}

              {/* Related Words Section */}
              {result.relatedWords && result.relatedWords.length > 0 && (
                <div className={`rounded-3xl p-6 mb-8 border transition-colors relative overflow-hidden ${isDarkMode ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'}`}>
                  <div className={`absolute -right-4 -top-4 opacity-5 ${isDarkMode ? 'text-indigo-500' : 'text-indigo-900'}`}>
                    <Link className="w-32 h-32" />
                  </div>
                  <h4 className={`text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                    <Link className="w-4 h-4" /> Related Words
                  </h4>
                  <p className={`text-sm mb-4 relative z-10 ${isDarkMode ? 'text-indigo-300' : 'text-indigo-700'}`}>
                    Words commonly used together or semantically related to <strong>{result.word}</strong>:
                  </p>
                  <div className="flex flex-wrap gap-2 relative z-10">
                    {result.relatedWords.map((related, idx) => (
                      <span 
                        key={idx} 
                        onClick={(e) => { e.stopPropagation(); handleSearch(undefined, related); }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold cursor-pointer transition-colors ${isDarkMode ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/40' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'}`}
                      >
                        {related}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {isCurrentWordSaved ? (
                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      setShowGlossary(true);
                      setShowHistory(false);
                      setShowDashboard(false);
                      setShowTranslator(false);
                      setShowQuiz(false);
                      setShowQuizSettings(false);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className={`flex-1 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all ${isDarkMode ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                  >
                    View in Glossary <ArrowRight className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={toggleSaveWord}
                    className={`px-6 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all ${isDarkMode ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white' : 'bg-gray-100 text-slate-600 hover:bg-gray-200 hover:text-slate-900 border border-gray-200'}`}
                    title="Remove from Vocabulary"
                  >
                    <Bookmark className="w-6 h-6 fill-current text-emerald-500" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={toggleSaveWord}
                  className={`w-full py-5 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#10B981] text-white hover:bg-[#059669] shadow-lg shadow-emerald-500/20`}
                >
                  <Bookmark className="w-5 h-5" /> Save to Vocabulary <ArrowRight className="w-5 h-5" />
                </button>
              )}

              {isCurrentWordSaved && (
                <>
                  <div className={`mt-4 p-4 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-100'}`}>
                    <p className={`text-sm text-center mb-3 font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Review this word now to update its schedule:</p>
                    <div className="grid grid-cols-4 gap-2">
                      <button onClick={() => handleManualReview('Again')} className="py-2 rounded-xl text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200">Again</button>
                      <button onClick={() => handleManualReview('Hard')} className="py-2 rounded-xl text-xs font-bold bg-orange-100 text-orange-700 hover:bg-orange-200">Hard</button>
                      <button onClick={() => handleManualReview('Good')} className="py-2 rounded-xl text-xs font-bold bg-blue-100 text-blue-700 hover:bg-blue-200">Good</button>
                      <button onClick={() => handleManualReview('Easy')} className="py-2 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-700 hover:bg-emerald-200">Easy</button>
                    </div>
                  </div>
                  
                  {(() => {
                    const savedWord = savedWords.find(w => w.word.toLowerCase() === result.word.toLowerCase());
                    return savedWord ? (
                      <div className={`mt-4 p-4 rounded-2xl border space-y-4 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-100'}`}>
                        <div>
                          <label className={`block text-xs font-bold mb-1 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Personal Notes</label>
                          <textarea 
                            value={savedWord.notes || ''}
                            onChange={(e) => updateSavedWordNotes(result.word, e.target.value)}
                            placeholder="Add your own notes, memory hooks, or examples..."
                            className={`w-full p-3 rounded-xl border text-sm focus:ring-2 focus:ring-[#10B981] outline-none resize-none h-20 ${isDarkMode ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-gray-200 text-slate-800'}`}
                          />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className={`block text-xs font-bold ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Custom Examples (one per line)</label>
                            <button 
                              onClick={() => generateExampleForWord(savedWord)}
                              disabled={isGeneratingExample}
                              className={`text-xs font-bold flex items-center gap-1 transition-colors ${isGeneratingExample ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode ? 'text-[#10B981] hover:text-[#34d399]' : 'text-[#10B981] hover:text-[#059669]'}`}
                            >
                              {isGeneratingExample ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Lightbulb className="w-3 h-3" />}
                              {isGeneratingExample ? 'Generating...' : 'Auto-Generate'}
                            </button>
                          </div>
                          <textarea 
                            value={savedWord.customExamples?.join('\n') || ''}
                            onChange={(e) => updateSavedWordExamples(result.word, e.target.value)}
                            placeholder="Add your own example sentences..."
                            className={`w-full p-3 rounded-xl border text-sm focus:ring-2 focus:ring-[#10B981] outline-none resize-none h-24 ${isDarkMode ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-gray-200 text-slate-800'}`}
                          />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className={`block text-xs font-bold ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Tags (comma separated)</label>
                            <button 
                              onClick={() => generateTagsForWord(savedWord)}
                              disabled={isGeneratingTags}
                              className={`text-xs font-bold flex items-center gap-1 transition-colors ${isGeneratingTags ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode ? 'text-[#10B981] hover:text-[#34d399]' : 'text-[#10B981] hover:text-[#059669]'}`}
                            >
                              {isGeneratingTags ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Lightbulb className="w-3 h-3" />}
                              {isGeneratingTags ? 'Generating...' : 'Auto-Generate'}
                            </button>
                          </div>
                          <input 
                            type="text"
                            value={savedWord.tags?.join(', ') || ''}
                            onChange={(e) => updateSavedWordTags(result.word, e.target.value)}
                            placeholder="e.g., travel, important, verbs"
                            className={`w-full p-3 rounded-xl border text-sm focus:ring-2 focus:ring-[#10B981] outline-none ${isDarkMode ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-gray-200 text-slate-800'}`}
                          />
                          {savedWord.tags && savedWord.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {savedWord.tags.map((tag, idx) => (
                                <span key={idx} className={`text-[10px] px-2 py-1 rounded-md uppercase tracking-wider font-bold ${isDarkMode ? 'bg-emerald-950/50 text-emerald-400' : 'bg-[#D1F4E6] text-[#10B981]'}`}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null;
                  })()}
                </>
              )}
            </div>
          </div>
          
          {/* Feedback Section */}
          <div className={`mt-8 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4 ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
            {feedbackSubmitted ? (
              <div className={`flex items-center gap-2 text-sm font-medium mx-auto sm:mx-0 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                <CheckCircle className="w-5 h-5" /> Thank you for your feedback!
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Was this helpful?</span>
                  <button onClick={() => setFeedbackSubmitted(true)} className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-100 text-slate-600'}`}>
                    <ThumbsUp className="w-4 h-4" />
                  </button>
                  <button onClick={() => setFeedbackSubmitted(true)} className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-100 text-slate-600'}`}>
                    <ThumbsDown className="w-4 h-4" />
                  </button>
                </div>
                <button onClick={() => setFeedbackSubmitted(true)} className={`flex items-center gap-2 text-sm font-medium transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}>
                  <Flag className="w-4 h-4" /> Report an issue
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}

      {/* Saved Vocabulary Section */}
      {!loading && !result && (
      <div className="w-full max-w-2xl mx-auto px-4 py-16 mt-auto">
        <div className="flex items-center justify-center gap-4 mb-10">
          <div className={`h-px flex-1 ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`}></div>
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-emerald-950/30 text-emerald-500' : 'bg-[#D1F4E6] text-[#10B981]'}`}>
            <Bookmark className="w-6 h-6" />
          </div>
          <div className={`h-px flex-1 ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`}></div>
        </div>
        
        <div className="text-center mb-10">
          <h2 className={`text-4xl font-outfit font-extrabold mb-3 text-3d-sm ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>My <span className="text-[#10B981]">Saved</span> Vocabulary</h2>
          <p className={`text-base mb-6 ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>{savedWords.length} words saved</p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 flex-wrap">
            <div className="flex justify-center gap-2 flex-wrap">
              {['All', 'Beginner', 'Intermediate', 'Advanced'].map(level => {
                let activeBgColor = 'bg-[#10B981]';
                if (level === 'Beginner') activeBgColor = 'bg-red-500';
                if (level === 'Intermediate') activeBgColor = 'bg-yellow-500';
                if (level === 'Advanced') activeBgColor = 'bg-blue-500';

                return (
                  <button
                    key={level}
                    onClick={() => setDifficultyFilter(level as any)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${difficultyFilter === level ? `${activeBgColor} text-white` : isDarkMode ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white' : 'bg-gray-100 text-slate-600 hover:bg-gray-200 hover:text-slate-900'}`}
                  >
                    {level === 'All' ? 'All Levels' : level}
                  </button>
                );
              })}
            </div>
            
            {allTags.length > 0 && (
              <select 
                value={selectedTagFilter}
                onChange={(e) => setSelectedTagFilter(e.target.value)}
                className={`px-4 py-2 rounded-xl text-sm font-bold outline-none border transition-colors sm:max-w-[150px] truncate ${
                  selectedTagFilter !== 'All'
                    ? (isDarkMode ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-400' : 'bg-emerald-50 border-emerald-500 text-emerald-600')
                    : (isDarkMode ? 'bg-[#111] border-white/10 text-white focus:border-[#10B981]' : 'bg-white border-gray-200 text-slate-700 focus:border-[#10B981]')
                }`}
              >
                <option value="All">All Tags</option>
                {allTags.map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        
        <div className={`rounded-[2.5rem] shadow-sm border p-8 md:p-12 ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}>
          {savedWords.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center mb-6 ${isDarkMode ? 'bg-emerald-950/30 text-emerald-500' : 'bg-[#F0FDF8] text-[#10B981]'}`}>
                <Bookmark className="w-10 h-10" />
              </div>
              <p className={`font-medium text-lg ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>No words saved yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredSavedWords.length === 0 ? (
                <div className="col-span-1 sm:col-span-2 text-center py-8">
                  <p className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>No words match your current filters.</p>
                </div>
              ) : (
                filteredSavedWords.map((item, idx) => (
                  <div 
                    key={idx}
                    onClick={() => handleSearch(undefined, item.word)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer group flex justify-between items-center ${isDarkMode ? 'border-white/10 hover:border-[#10B981]/50 hover:bg-white/5' : 'border-gray-100 hover:border-[#10B981]/30 hover:bg-[#F0FDF8]'}`}
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <h4 className={`font-bold text-lg transition-colors flex items-center gap-2 ${isDarkMode ? 'text-gray-200 group-hover:text-[#10B981]' : 'text-slate-800 group-hover:text-[#10B981]'}`}>
                          {item.word}
                          {item.difficultyLevel && (
                            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                              item.difficultyLevel.toLowerCase() === 'beginner' ? 'border-red-500/30 text-red-600 bg-red-500/10' :
                              item.difficultyLevel.toLowerCase() === 'intermediate' ? 'border-yellow-500/30 text-yellow-600 bg-yellow-500/10' :
                              'border-blue-500/30 text-blue-600 bg-blue-500/10'
                            }`}>
                              {item.difficultyLevel}
                            </span>
                          )}
                        </h4>
                        <div className={`text-sm mt-1 flex items-center gap-1.5 ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                          <span>{item.bengaliMeaning}</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); playBengaliPronunciation(item.bengaliMeaning); }}
                            className={`p-1 rounded-full transition-colors ${isSpeaking ? 'text-red-500' : isDarkMode ? 'text-gray-400 hover:bg-white/10 hover:text-red-400' : 'text-slate-400 hover:bg-gray-100 hover:text-red-500'}`}
                            title="Play Bengali Pronunciation"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {item.tags && item.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {item.tags.map((tag, tIdx) => (
                              <span key={tIdx} className={`text-[10px] flex items-center gap-1 font-bold px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                                <Tag className="w-2.5 h-2.5" /> {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        {(item.notes || (item.customExamples && item.customExamples.length > 0)) && (
                          <div className={`mt-3 pt-3 border-t flex flex-col gap-2 ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
                            {item.notes && (
                              <div className={`text-xs italic ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                                📝 {item.notes}
                              </div>
                            )}
                            {item.customExamples && item.customExamples.length > 0 && (
                              <div className="flex flex-col gap-1">
                                {item.customExamples.map((ex, exIdx) => (
                                  <div key={exIdx} className={`text-xs flex items-start gap-1 font-medium ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                                    <span className="opacity-70">&bull;</span> {ex}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <ArrowRight className={`w-5 h-5 shrink-0 ml-4 transition-colors ${isDarkMode ? 'text-gray-600 group-hover:text-[#10B981]' : 'text-gray-300 group-hover:text-[#10B981]'}`} />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      )}
      </>
      )}

      {/* Clear History Confirmation Dialog */}
      <AnimatePresence>
        {showClearHistoryDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className={`w-full max-w-sm rounded-[2rem] p-6 shadow-2xl border text-center ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}
            >
              <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4 ${isDarkMode ? 'bg-red-500/10 text-red-500' : 'bg-red-50 text-red-600'}`}>
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h3 className={`text-xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Clear Search History?</h3>
              <p className={`text-sm mb-6 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                Are you sure you want to delete all your search history? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearHistoryDialog(false)}
                  className={`flex-1 py-3 rounded-xl font-bold transition-colors ${isDarkMode ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-slate-700 hover:bg-gray-200'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setSearchHistory([]);
                    setShowClearHistoryDialog(false);
                  }}
                  className="flex-1 py-3 rounded-xl font-bold bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
                >
                  Clear All
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quiz Settings Modal */}
      <AnimatePresence>
        {showQuizSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowQuizSettings(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`w-full max-w-lg p-6 sm:p-8 rounded-3xl shadow-xl border overflow-y-auto max-h-[90vh] ${isDarkMode ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className={`font-outfit text-2xl font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                    <Settings className="w-6 h-6 text-emerald-500" /> Quiz Settings
                  </h3>
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Customize your vocabulary quiz</p>
                </div>
                <button
                  onClick={() => setShowQuizSettings(false)}
                  className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className={`block text-sm font-bold mb-3 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Questions Per Quiz</label>
                  <div className="flex flex-wrap gap-2">
                    {[5, 10, 15, 20].map(count => (
                      <button
                        key={count}
                        onClick={() => setQuizSettings({...quizSettings, questionCount: count})}
                        className={`flex-1 min-w-[80px] py-2.5 rounded-xl text-sm font-bold transition-all ${
                          quizSettings.questionCount === count 
                            ? 'bg-[#10B981] text-white shadow-md shadow-[#10B981]/30' 
                            : isDarkMode ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-bold mb-3 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Time Limit Per Question</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([0, 10, 15, 30] as const).map(limit => (
                      <button
                        key={limit}
                        onClick={() => setQuizSettings({...quizSettings, timeLimitSeconds: limit})}
                        className={`py-2.5 rounded-xl text-sm font-bold transition-all ${
                          quizSettings.timeLimitSeconds === limit 
                            ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30' 
                            : isDarkMode ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {limit === 0 ? 'No Limit' : `${limit}s`}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-bold mb-3 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Question Types</label>
                  <div className="flex flex-col gap-2">
                    <label className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${isDarkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}>
                          <Book className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Bengali Meaning</span>
                          <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Translate words between English & Bengali</span>
                        </div>
                      </div>
                      <div className="relative flex items-center justify-center">
                        <input 
                          type="checkbox" 
                          className="peer sr-only"
                          checked={quizSettings.types.meaning}
                          onChange={(e) => setQuizSettings({...quizSettings, types: {...quizSettings.types, meaning: e.target.checked}})}
                        />
                        <div className={`w-6 h-6 rounded-full transition-colors flex items-center justify-center ${quizSettings.types.meaning ? 'bg-[#10B981]' : isDarkMode ? 'bg-gray-800 border-2 border-gray-600' : 'bg-white border-2 border-gray-300'}`}>
                          {quizSettings.types.meaning && <CheckCircle className="w-4 h-4 text-white" />}
                        </div>
                      </div>
                    </label>

                    <label className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${isDarkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-100 text-amber-600'}`}>
                          <Volume2 className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Pronunciation Match</span>
                          <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Identify the word by its audio</span>
                        </div>
                      </div>
                      <div className="relative flex items-center justify-center">
                        <input 
                          type="checkbox" 
                          className="peer sr-only"
                          checked={quizSettings.types.pronunciation}
                          onChange={(e) => setQuizSettings({...quizSettings, types: {...quizSettings.types, pronunciation: e.target.checked}})}
                        />
                        <div className={`w-6 h-6 rounded-full transition-colors flex items-center justify-center ${quizSettings.types.pronunciation ? 'bg-[#10B981]' : isDarkMode ? 'bg-gray-800 border-2 border-gray-600' : 'bg-white border-2 border-gray-300'}`}>
                          {quizSettings.types.pronunciation && <CheckCircle className="w-4 h-4 text-white" />}
                        </div>
                      </div>
                    </label>

                    <label className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${isDarkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-sky-900/30 text-sky-400' : 'bg-sky-100 text-sky-600'}`}>
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Examples</span>
                          <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Fill in the blanks with target words</span>
                        </div>
                      </div>
                      <div className="relative flex items-center justify-center">
                        <input 
                          type="checkbox" 
                          className="peer sr-only"
                          checked={quizSettings.types.example}
                          onChange={(e) => setQuizSettings({...quizSettings, types: {...quizSettings.types, example: e.target.checked}})}
                        />
                        <div className={`w-6 h-6 rounded-full transition-colors flex items-center justify-center ${quizSettings.types.example ? 'bg-[#10B981]' : isDarkMode ? 'bg-gray-800 border-2 border-gray-600' : 'bg-white border-2 border-gray-300'}`}>
                          {quizSettings.types.example && <CheckCircle className="w-4 h-4 text-white" />}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              <div className={`mt-8 pt-6 border-t flex gap-3 ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                <button
                  onClick={() => setShowQuizSettings(false)}
                  className={`flex-1 py-3 rounded-xl font-bold transition-colors ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SRS Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className={`w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl border ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className={`text-2xl font-outfit font-bold ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>Settings</h3>
                <button 
                  onClick={() => setShowSettings(false)}
                  className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-8 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {/* General Settings */}
                <div className="space-y-4">
                  <h4 className={`text-lg font-bold border-b pb-2 ${isDarkMode ? 'text-white border-white/10' : 'text-slate-800 border-gray-100'}`}>Learning Goals & Reminders</h4>
                  
                  <div>
                    <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                      Daily Goal (number of reviews/words)
                      <div className="relative group">
                        <Info className="w-4 h-4 text-gray-400 cursor-help" />
                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                          Set a target for how many words you want to review or learn each day. Your progress will be tracked in the dashboard.
                        </div>
                      </div>
                    </label>
                    <input 
                      type="number" 
                      min="1"
                      value={userStats.dailyGoal}
                      onChange={(e) => {
                        const newGoal = parseInt(e.target.value) || 10;
                        setUserStats(prev => ({...prev, dailyGoal: newGoal}));
                      }}
                      className={`w-full p-3 rounded-xl border focus:ring-2 focus:ring-[#10B981] outline-none ${isDarkMode ? 'bg-black border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-slate-800'}`}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between pt-2">
                    <label className={`flex items-center gap-2 text-sm font-bold ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                      Daily Study Reminders
                      <div className="relative group">
                        <Info className="w-4 h-4 text-gray-400 cursor-help" />
                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                          Enable to get a browser notification or in-app reminder when you have words due for review.
                        </div>
                      </div>
                    </label>
                    <button
                      onClick={async () => {
                        const newState = !userStats.dailyReminders;
                        setUserStats(prev => ({...prev, dailyReminders: newState}));
                        if (newState && "Notification" in window && Notification.permission === "default") {
                          await Notification.requestPermission();
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${userStats.dailyReminders ? 'bg-[#10B981]' : (isDarkMode ? 'bg-gray-700' : 'bg-gray-300')}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${userStats.dailyReminders ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>

                {/* Text-to-Speech (TTS) Settings */}
                <div className="space-y-4">
                  <h4 className={`text-lg font-bold border-b pb-2 ${isDarkMode ? 'text-white border-white/10' : 'text-slate-800 border-gray-100'}`}>Text-to-Speech (TTS) Settings</h4>
                  
                  <div>
                    <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                      TTS Engine
                      <div className="relative group">
                        <Info className="w-4 h-4 text-gray-400 cursor-help" />
                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                          Standard uses your device&apos;s built-in voices (fast, works offline). Advanced uses Gemini AI for highly natural, expressive pronunciation (requires internet).
                        </div>
                      </div>
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setTtsEngine('browser')}
                        className={`flex-1 py-2 px-4 rounded-xl font-bold text-sm transition-colors ${ttsEngine === 'browser' ? 'bg-[#10B981] text-white' : isDarkMode ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-slate-600 hover:bg-gray-200'}`}
                      >
                        Standard (Browser)
                      </button>
                      <button
                        onClick={() => setTtsEngine('gemini')}
                        className={`flex-1 py-2 px-4 rounded-xl font-bold text-sm transition-colors ${ttsEngine === 'gemini' ? 'bg-[#10B981] text-white' : isDarkMode ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-slate-600 hover:bg-gray-200'}`}
                      >
                        Advanced (Gemini)
                      </button>
                    </div>
                  </div>

                  {ttsEngine === 'gemini' ? (
                    <>
                      <div>
                        <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                          Advanced Voice
                          <div className="relative group">
                            <Info className="w-4 h-4 text-gray-400 cursor-help" />
                            <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                              Choose from different high-quality AI voices provided by Gemini. Each has a distinct tone and personality.
                            </div>
                          </div>
                        </label>
                        <select
                          value={geminiVoice}
                          onChange={(e) => setGeminiVoice(e.target.value)}
                          className={`w-full p-3 rounded-xl border focus:ring-2 focus:ring-[#10B981] outline-none ${isDarkMode ? 'bg-black border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-slate-800'}`}
                        >
                          <option value="Kore">Kore (Female)</option>
                          <option value="Puck">Puck (Male)</option>
                          <option value="Charon">Charon (Male)</option>
                          <option value="Fenrir">Fenrir (Male)</option>
                          <option value="Zephyr">Zephyr (Female)</option>
                        </select>
                      </div>
                      <div>
                        <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                          Regional Accent
                          <div className="relative group">
                            <Info className="w-4 h-4 text-gray-400 cursor-help" />
                            <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                              Adjusts the pronunciation rules to match specific English dialects. Note: This directs the AI, but results may vary based on the selected voice.
                            </div>
                          </div>
                        </label>
                        <select
                          value={geminiAccent}
                          onChange={(e) => setGeminiAccent(e.target.value)}
                          className={`w-full p-3 rounded-xl border focus:ring-2 focus:ring-[#10B981] outline-none ${isDarkMode ? 'bg-black border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-slate-800'}`}
                        >
                          <option value="US English">US English</option>
                          <option value="UK English">UK English</option>
                          <option value="Australian English">Australian English</option>
                          <option value="Indian English">Indian English</option>
                          <option value="Irish English">Irish English</option>
                          <option value="Scottish English">Scottish English</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                        Browser Voice
                        <div className="relative group">
                          <Info className="w-4 h-4 text-gray-400 cursor-help" />
                          <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                            Select from the available browser voices installed on your device or browser. Options vary by device.
                          </div>
                        </div>
                      </label>
                      <select
                        value={selectedVoiceURI}
                        onChange={(e) => setSelectedVoiceURI(e.target.value)}
                        className={`w-full p-3 rounded-xl border focus:ring-2 focus:ring-[#10B981] outline-none ${isDarkMode ? 'bg-black border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-slate-800'}`}
                      >
                        <option value="">Default Browser Voice</option>
                        {availableVoices.map(voice => (
                          <option key={voice.voiceURI} value={voice.voiceURI}>
                            {voice.name} ({voice.lang})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                      Speech Rate: {speechRate.toFixed(1)}x
                      <div className="relative group">
                        <Info className="w-4 h-4 text-gray-400 cursor-help" />
                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                          How fast the words are spoken. Slower speeds (0.8x) are highly recommended for practicing listening comprehension.
                        </div>
                      </div>
                    </label>
                    <input 
                      type="range" 
                      min="0.5" 
                      max="2.0" 
                      step="0.1"
                      value={speechRate}
                      onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                      className="w-full accent-[#10B981]"
                    />
                    <div className={`flex justify-between text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                      <span>Slower</span>
                      <span>Normal</span>
                      <span>Faster</span>
                    </div>
                  </div>
                </div>

                {/* SRS Settings */}
                <div className="space-y-4">
                  <h4 className={`text-lg font-bold border-b pb-2 ${isDarkMode ? 'text-white border-white/10' : 'text-slate-800 border-gray-100'}`}>Spaced Repetition (SRS)</h4>
                  
                  <div>
                    <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                      Base Interval (days)
                      <div className="relative group">
                        <Info className="w-4 h-4 text-gray-400 cursor-help" />
                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                          The time in days until the next review if you mark a new word as &quot;Good&quot;. If you mark a word as &quot;Again&quot;, it resets to this interval.
                        </div>
                      </div>
                    </label>
                    <input 
                      type="number" 
                      min="1"
                      value={srsSettings.baseInterval}
                      onChange={(e) => setSrsSettings({...srsSettings, baseInterval: parseInt(e.target.value) || 1})}
                      className={`w-full p-3 rounded-xl border focus:ring-2 focus:ring-[#10B981] outline-none ${isDarkMode ? 'bg-black border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-slate-800'}`}
                    />
                  </div>

                  <div>
                    <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                      Second Interval (days)
                      <div className="relative group">
                        <Info className="w-4 h-4 text-gray-400 cursor-help" />
                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                          The time in days until the next review after you successfully remember a word for the second time in a row.
                        </div>
                      </div>
                    </label>
                    <input 
                      type="number" 
                      min="1"
                      value={srsSettings.secondInterval}
                      onChange={(e) => setSrsSettings({...srsSettings, secondInterval: parseInt(e.target.value) || 1})}
                      className={`w-full p-3 rounded-xl border focus:ring-2 focus:ring-[#10B981] outline-none ${isDarkMode ? 'bg-black border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-slate-800'}`}
                    />
                  </div>

                  <div>
                    <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                      Starting Ease Factor
                      <div className="relative group">
                        <Info className="w-4 h-4 text-gray-400 cursor-help" />
                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                          A multiplier that determines how quickly the review intervals grow. A higher number means the intervals will increase faster (you&apos;ll see the word less often). Default is 2.5.
                        </div>
                      </div>
                    </label>
                    <input 
                      type="number" 
                      step="0.1"
                      min="1.3"
                      value={srsSettings.startingEase}
                      onChange={(e) => setSrsSettings({...srsSettings, startingEase: parseFloat(e.target.value) || 2.5})}
                      className={`w-full p-3 rounded-xl border focus:ring-2 focus:ring-[#10B981] outline-none ${isDarkMode ? 'bg-black border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-slate-800'}`}
                    />
                  </div>

                  <div>
                    <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                      Learned Threshold (days)
                      <div className="relative group">
                        <Info className="w-4 h-4 text-gray-400 cursor-help" />
                        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl text-xs shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-600 border border-gray-100'}`}>
                          When a word&apos;s next review interval reaches this many days, it is considered fully &quot;Learned&quot; and will contribute to your Learned Words statistic.
                        </div>
                      </div>
                    </label>
                    <input 
                      type="number" 
                      min="1"
                      value={srsSettings.learnedThreshold}
                      onChange={(e) => setSrsSettings({...srsSettings, learnedThreshold: parseInt(e.target.value) || 21})}
                      className={`w-full p-3 rounded-xl border focus:ring-2 focus:ring-[#10B981] outline-none ${isDarkMode ? 'bg-black border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-slate-800'}`}
                    />
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowSettings(false)}
                className="w-full mt-8 bg-[#10B981] text-white py-4 rounded-xl font-bold hover:bg-[#059669] transition-colors"
              >
                Save Settings
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feature Details Modal */}
      <AnimatePresence>
        {selectedFeatureDetails && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setSelectedFeatureDetails(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl border ${isDarkMode ? 'bg-[#111] border-white/10' : 'bg-white border-gray-100'}`}
            >
              <div className="flex justify-between items-start mb-6">
                <div className={`w-16 h-16 rounded-[2rem] flex items-center justify-center ${isDarkMode ? selectedFeatureDetails.darkBgClass + ' ' + selectedFeatureDetails.darkColorClass : selectedFeatureDetails.bgClass + ' ' + selectedFeatureDetails.colorClass}`}>
                  {selectedFeatureDetails.icon}
                </div>
                <button 
                  onClick={() => setSelectedFeatureDetails(null)}
                  className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <h3 className={`text-3xl font-outfit font-extrabold mb-6 ${isDarkMode ? 'text-white' : 'text-[#1E293B]'}`}>
                {selectedFeatureDetails.title}
              </h3>

              <div className="space-y-6">
                <div>
                  <h4 className={`text-sm font-bold tracking-widest uppercase mb-4 flex items-center gap-2 ${isDarkMode ? selectedFeatureDetails.darkColorClass : selectedFeatureDetails.colorClass}`}>
                    ⚙️ What It Does
                  </h4>
                  <ul className="space-y-3">
                    {selectedFeatureDetails.whatItDoes.map((item, index) => (
                      <li key={index} className={`text-lg leading-relaxed flex items-start gap-3 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className={`text-sm font-bold tracking-widest uppercase mb-4 flex items-center gap-2 ${isDarkMode ? selectedFeatureDetails.darkColorClass : selectedFeatureDetails.colorClass}`}>
                    🌟 Why You Need It
                  </h4>
                  <ul className="space-y-3">
                    {selectedFeatureDetails.whyYouNeedIt.map((item, index) => (
                      <li key={index} className={`text-lg leading-relaxed flex items-start gap-3 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <button 
                onClick={() => setSelectedFeatureDetails(null)}
                className={`w-full mt-8 py-4 rounded-xl font-bold transition-colors ${isDarkMode ? selectedFeatureDetails.darkBgClass + ' ' + selectedFeatureDetails.darkColorClass + ' hover:bg-white/10' : selectedFeatureDetails.bgClass + ' ' + selectedFeatureDetails.colorClass + ' hover:brightness-95'}`}
              >
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl z-[100] font-medium flex items-center gap-3 backdrop-blur-md ${isDarkMode ? 'bg-emerald-900/90 text-emerald-100 border border-emerald-500/30' : 'bg-emerald-100/90 text-emerald-800 border border-emerald-200 shadow-emerald-500/20'}`}
          >
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span className="truncate max-w-[200px] sm:max-w-xs">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
