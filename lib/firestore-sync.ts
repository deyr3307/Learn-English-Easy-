import { db, handleFirestoreError, OperationType } from './firebase';
import { collection, doc, writeBatch, serverTimestamp, getDocs, query, limit } from 'firebase/firestore';

export const syncSavedWordsToFirestore = async (userId: string, savedWords: any[]) => {
  try {
    const batch = writeBatch(db);
    const wordsRef = collection(db, `users/${userId}/savedWords`);
    
    // Get existing words first to delete the ones removed locally
    const existingQ = query(wordsRef);
    const snapshot = await getDocs(existingQ);
    const existingIds = new Set(snapshot.docs.map(doc => doc.id));
    
    const currentIds = new Set(savedWords.map(w => w.word.toLowerCase()));

    // Delete missing ones
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        batch.delete(doc(wordsRef, id));
      }
    }

    // Set existing ones
    savedWords.forEach(word => {
      const wordDoc = doc(wordsRef, word.word.toLowerCase());
      batch.set(wordDoc, {
        wordData: JSON.stringify(word),
        updatedAt: serverTimestamp()
      }, { merge: true });
    });
    
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}/savedWords`);
  }
};

export const fetchSavedWordsFromFirestore = async (userId: string) => {
  try {
    const wordsRef = collection(db, `users/${userId}/savedWords`);
    const q = query(wordsRef);
    const snapshot = await getDocs(q);
    
    const words: any[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.wordData) {
        words.push(JSON.parse(data.wordData));
      }
    });
    return words;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${userId}/savedWords`);
    return [];
  }
};

export const syncSessionToFirestore = async (userId: string, sessionId: string, sessionData: any) => {
  try {
    const batch = writeBatch(db);
    const sessionDocRef = doc(db, `users/${userId}/sessions/${sessionId}`);
    
    batch.set(sessionDocRef, {
      sessionData: JSON.stringify(sessionData),
      updatedAt: serverTimestamp()
    }, { merge: true });
    
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}/sessions/${sessionId}`);
  }
};

export const fetchSessionFromFirestore = async (userId: string, sessionId: string) => {
  try {
    const sessionDocRef = doc(db, `users/${userId}/sessions/${sessionId}`);
    const snapshot = await getDocs(query(collection(db, `users/${userId}/sessions`), limit(1))); // We could use getDoc but following pattern
    // Update to use doc getter
    const { getDoc } = require('firebase/firestore');
    const docSnapshot = await getDoc(sessionDocRef);
    if (docSnapshot.exists() && docSnapshot.data().sessionData) {
      return JSON.parse(docSnapshot.data().sessionData);
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${userId}/sessions/${sessionId}`);
    return null;
  }
};
