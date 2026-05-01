import React from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth } from '../lib/firebase';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';

export const UserProfile = ({ isDarkMode }: { isDarkMode: boolean }) => {
  const [user, loading] = useAuthState(auth);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Error logging in', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error logging out', error);
    }
  };

  if (loading) {
    return <div className="text-sm">Loading...</div>;
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img 
          src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
          alt="User Profile" 
          className="w-8 h-8 rounded-full border border-emerald-500"
          referrerPolicy="no-referrer"
        />
        <button 
          onClick={handleLogout}
          className={`text-sm font-medium ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Logout
        </button>
      </div>
    );
  }

  return (
    <button 
      onClick={handleLogin}
      className={`px-4 py-1.5 rounded-full text-sm font-bold border transition-colors ${
        isDarkMode 
          ? 'bg-transparent border-white/20 text-white hover:bg-white/10' 
          : 'bg-transparent border-slate-300 text-slate-800 hover:bg-slate-100'
      }`}
    >
      Sign In
    </button>
  );
};
