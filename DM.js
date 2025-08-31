// DM.js — Enhanced Full-featured Direct Messaging
import { auth, db } from "./firebase.js";
import { collection, doc, addDoc, query, orderBy, onSnapshot, serverTimestamp, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

let domElements = {
  friendsList: document.getElementById("friendsList"),
  chatContainer: document.getElementById("chatContainer")
};

const activeDMs = {}; // { friendUid: { container, input, messageBox, unsubscribe } }
const profileCache = {}; // Cache profiles to reduce Firestore calls
let currentUserProfile = null;

// Initialize current user profile on auth change
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUserProfile = await fetchProfile(user.uid);
  } else {
    currentUserProfile = null;
    // Close all active DMs when user logs out
    Object.keys(activeDMs).forEach(friendUid => {
      closeDM(friendUid);
    });
  }
});

function defaultAvatar() { 
  return "https://www.gravatar.com/avatar/?d=mp&s=160"; 
}

// Enhanced profile fetching with caching and retry logic
async function fetchProfile(uid, retries = 3) {
  if (!uid) return { username: "Unknown", photoURL: defaultAvatar() };
  
  // Return cached profile if available
  if (profileCache[uid]) return profileCache[uid];
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        const profile = {
          username: snap.data().username || "Unknown",
          photoURL: snap.data().photoURL || defaultAvatar(),
          ...snap.data()
        };
        profileCache[uid] = profile; // Cache the profile
        return profile;
      }
    } catch (e) {
      console.error(`fetchProfile error (attempt ${attempt + 1}):`, e);
      if (attempt === retries - 1) {
        // Return default profile on final failure
        const defaultProfile = { username: "Unknown", photoURL: defaultAvatar() };
        profileCache[uid] = defaultProfile;
        return defaultProfile;
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  
  const defaultProfile = { username: "Unknown", photoURL: defaultAvatar() };
  profileCache[uid] = defaultProfile;
  return defaultProfile;
}

// Create the "+" button next to friend with better styling
function createDMButton(friendUid, friendName) {
  const btn = document.createElement("button");
  btn.textContent = "💬";
  btn.title = `DM ${friendName}`;
  btn.className = "dm-btn";
  btn.style.cssText = `
    font-weight: bold; font-size: 14px; width: 32px; height: 32px;
    margin-left: 8px; border-radius: 50%; border: 1px solid #555;
    background: #4CAF50; color: white; cursor: pointer; transition: all 0.2s;
    display: flex; align-items: center; justify-content: center;
  `;
  
  // Add hover effects
  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#45a049';
    btn.style.transform = 'scale(1.1)';
  });
  
  btn.addEventListener('mouseleave', () => {
    btn.style.background = '#4CAF50';
    btn.style.transform = 'scale(1)';
  });
  
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDM(friendUid, friendName);
  };
  
  return btn;
}

// Toggle DM visibility with animation
function toggleDM(friendUid, friendName) {
  if (activeDMs[friendUid]) {
    const dm = activeDMs[friendUid];
    const isHidden = dm.container.style.display === "none";
    
    if (isHidden) {
      dm.container.style.display = "block";
      dm.container.style.opacity = "0";
      dm.container.style.transform = "translateY(-10px)";
      
      // Animate in
      setTimeout(() => {
        dm.container.style.transition = "all 0.3s ease";
        dm.container.style.opacity = "1";
        dm.container.style.transform = "translateY(0)";
      }, 10);
    } else {
      dm.container.style.transition = "all 0.3s ease";
      dm.container.style.opacity = "0";
      dm.container.style.transform = "translateY(-10px)";
      
      setTimeout(() => {
        dm.container.style.display = "none";
      }, 300);
    }
    return;
  }
  openDM(friendUid, friendName);
}

// Generate consistent Firestore doc ID
function getDMDocId(uid1, uid2) {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
}

// Close DM and cleanup
function closeDM(friendUid) {
  if (activeDMs[friendUid]) {
    const dm = activeDMs[friendUid];
    
    // Unsubscribe from listener
    if (dm.unsubscribe) {
      dm.unsubscribe();
    }
    
    // Remove container with animation
    dm.container.style.transition = "all 0.3s ease";
    dm.container.style.opacity = "0";
    dm.container.style.transform = "translateX(100%)";
    
    setTimeout(() => {
      if (dm.container.parentNode) {
        dm.container.parentNode.removeChild(dm.container);
      }
    }, 300);
    
    delete activeDMs[friendUid];
  }
}

// Enhanced message sending with better error handling
async function sendMessage(friendUid, text, messageInput, retries = 3) {
  if (!auth.currentUser) {
    throw new Error("User not authenticated");
  }

  if (!text.trim()) {
    throw new Error("Message cannot be empty");
  }

  const dmRef = collection(db, "dms", getDMDocId(auth.currentUser.uid, friendUid), "messages");
  
  // Get fresh profile data
  const meProfile = currentUserProfile || await fetchProfile(auth.currentUser.uid);
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await addDoc(dmRef, {
        text: text.trim(),
        senderId: auth.currentUser.uid,
        senderName: meProfile.username || "Unknown",
        senderPhotoURL: meProfile.photoURL || defaultAvatar(),
        timestamp: serverTimestamp()
      });
      
      // Clear input on successful send
      messageInput.value = "";
      messageInput.disabled = false;
      messageInput.placeholder = `Message...`;
      
      return; // Success
      
    } catch (err) {
      console.error(`Send message attempt ${attempt + 1} failed:`, err);
      
      if (attempt === retries - 1) {
        // Final attempt failed
        messageInput.disabled = false;
        messageInput.placeholder = "Failed to send. Try again...";
        throw new Error(`Failed to send message after ${retries} attempts: ${err.message}`);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

// Create typing indicator
function createTypingIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "typing-indicator";
  indicator.style.cssText = `
    display: none; padding: 4px 8px; font-style: italic; color: #666;
    font-size: 12px; background: #f0f0f0; margin: 2px 0; border-radius: 4px;
  `;
  indicator.textContent = "User is typing...";
  return indicator;
}

// Enhanced DM box creation with better UX
async function openDM(friendUid, friendName) {
  if (!auth.currentUser) {
    alert("Please log in to send messages");
    return;
  }

  // Prevent duplicate DMs
  if (activeDMs[friendUid]) {
    toggleDM(friendUid, friendName);
    return;
  }

  try {
    const meProfile = currentUserProfile || await fetchProfile(auth.currentUser.uid);
    const friendProfile = await fetchProfile(friendUid);

    const dmContainer = document.createElement("div");
    dmContainer.className = "dm-container";
    dmContainer.style.cssText = `
      border: 1px solid #ddd; padding: 12px; margin: 8px 0; border-radius: 12px;
      background: linear-gradient(145deg, #ffffff, #f8f9fa); max-width: 420px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1); position: relative;
      opacity: 0; transform: translateY(-20px); transition: all 0.3s ease;
    `;

    // Header with profile info
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex; justify-content: space-between; align-items: center; 
      margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #eee;
    `;
    
    const profileInfo = document.createElement("div");
    profileInfo.style.cssText = "display: flex; align-items: center; gap: 8px;";
    
    const avatar = document.createElement("img");
    avatar.src = friendProfile.photoURL || defaultAvatar();
    avatar.style.cssText = "width: 32px; height: 32px; border-radius: 50%; object-fit: cover;";
    avatar.onerror = () => { avatar.src = defaultAvatar(); };
    
    const nameDiv = document.createElement("div");
    nameDiv.style.cssText = "font-weight: 600; color: #333; font-size: 14px;";
    nameDiv.textContent = friendProfile.username || friendName;
    
    profileInfo.appendChild(avatar);
    profileInfo.appendChild(nameDiv);
    
    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "✕";
    closeBtn.title = "Close chat";
    closeBtn.style.cssText = `
      font-weight: bold; border: none; background: none; cursor: pointer; 
      color: #666; font-size: 16px; padding: 4px; border-radius: 50%;
      transition: all 0.2s; width: 24px; height: 24px; display: flex;
      align-items: center; justify-content: center;
    `;
    closeBtn.onmouseenter = () => { closeBtn.style.background = "#f0f0f0"; closeBtn.style.color = "#d00"; };
    closeBtn.onmouseleave = () => { closeBtn.style.background = "none"; closeBtn.style.color = "#666"; };
    closeBtn.onclick = () => closeDM(friendUid);
    
    header.appendChild(profileInfo);
    header.appendChild(closeBtn);
    dmContainer.appendChild(header);

    // Message box with better styling
    const messageBox = document.createElement("div");
    messageBox.className = "message-box";
    messageBox.style.cssText = `
      height: 200px; overflow-y: auto; border: 1px solid #e0e0e0; 
      padding: 8px; margin-bottom: 8px; background: white; border-radius: 8px;
      scroll-behavior: smooth;
    `;
    dmContainer.appendChild(messageBox);

    // Typing indicator
    const typingIndicator = createTypingIndicator();
    dmContainer.appendChild(typingIndicator);

    // Input area with better UX
    const inputWrapper = document.createElement("div");
    inputWrapper.style.cssText = "display: flex; gap: 8px; align-items: flex-end;";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = `Message ${friendProfile.username || friendName}...`;
    input.className = "dm-input";
    input.style.cssText = `
      flex: 1; padding: 10px; border-radius: 20px; border: 1px solid #ddd;
      outline: none; transition: border-color 0.2s; font-size: 14px;
      background: #fafafa;
    `;
    
    input.onfocus = () => { input.style.borderColor = "#2d89ef"; input.style.background = "white"; };
    input.onblur = () => { input.style.borderColor = "#ddd"; input.style.background = "#fafafa"; };

    const sendBtn = document.createElement("button");
    sendBtn.innerHTML = "➤";
    sendBtn.title = "Send message";
    sendBtn.className = "send-btn";
    sendBtn.style.cssText = `
      padding: 10px 16px; cursor: pointer; border-radius: 50%; 
      background: #2d89ef; color: white; border: none; font-size: 16px;
      transition: all 0.2s; width: 44px; height: 44px; display: flex;
      align-items: center; justify-content: center;
    `;
    
    sendBtn.onmouseenter = () => { sendBtn.style.background = "#1a6bcc"; sendBtn.style.transform = "scale(1.05)"; };
    sendBtn.onmouseleave = () => { sendBtn.style.background = "#2d89ef"; sendBtn.style.transform = "scale(1)"; };

    inputWrapper.appendChild(input);
    inputWrapper.appendChild(sendBtn);
    dmContainer.appendChild(inputWrapper);

    // Add to chat container
    if (!domElements.chatContainer) {
      console.error("Chat container not found");
      return;
    }
    
    domElements.chatContainer.appendChild(dmContainer);

    // Animate in
    setTimeout(() => {
      dmContainer.style.opacity = "1";
      dmContainer.style.transform = "translateY(0)";
    }, 10);

    // Setup real-time messaging
    const dmRef = collection(db, "dms", getDMDocId(auth.currentUser.uid, friendUid), "messages");
    const q = query(dmRef, orderBy("timestamp"));

    // Listen for messages in real-time with error handling
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        messageBox.innerHTML = "";
        
        snapshot.docs.forEach(docSnap => {
          const m = docSnap.data();
          const msgDiv = document.createElement("div");
          
          const isMe = m.senderId === auth.currentUser.uid;
          msgDiv.style.cssText = `
            margin: 4px 0; padding: 8px 12px; border-radius: 16px; max-width: 80%;
            word-wrap: break-word; position: relative;
            background: ${isMe ? "#2d89ef" : "#e9ecef"};
            color: ${isMe ? "white" : "#333"};
            margin-left: ${isMe ? "auto" : "0"};
            margin-right: ${isMe ? "0" : "auto"};
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
          `;
          
          const timestamp = m.timestamp?.toDate ? 
            new Date(m.timestamp.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 
            "...";
          
          msgDiv.innerHTML = `
            <div style="font-size: 14px; line-height: 1.4;">${m.text}</div>
            <div style="font-size: 10px; opacity: 0.7; margin-top: 2px;">${timestamp}</div>
          `;
          
          messageBox.appendChild(msgDiv);
        });
        
        // Smooth scroll to bottom
        messageBox.scrollTop = messageBox.scrollHeight;
      },
      (error) => {
        console.error("Message listener error:", error);
        // Show error in message box
        messageBox.innerHTML = `
          <div style="text-align: center; color: #d00; padding: 20px;">
            Failed to load messages. Please refresh and try again.
          </div>
        `;
      }
    );

    // Store DM info with unsubscribe function
    activeDMs[friendUid] = { container: dmContainer, input, messageBox, unsubscribe };

    // Enhanced message sending with loading states
    const handleSendMessage = async () => {
      const text = input.value.trim();
      if (!text) return;

      // Disable input and show loading
      input.disabled = true;
      input.placeholder = "Sending...";
      sendBtn.disabled = true;
      sendBtn.style.opacity = "0.6";

      try {
        await sendMessage(friendUid, text, input);
      } catch (err) {
        console.error("Failed to send DM:", err);
        
        // Show user-friendly error
        const errorDiv = document.createElement("div");
        errorDiv.style.cssText = `
          background: #ffebee; color: #c62828; padding: 8px; border-radius: 4px;
          font-size: 12px; margin: 4px 0; text-align: center;
        `;
        errorDiv.textContent = "Failed to send message. Please try again.";
        messageBox.appendChild(errorDiv);
        messageBox.scrollTop = messageBox.scrollHeight;
        
        // Restore message to input
        input.value = text;
      } finally {
        // Re-enable input
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.style.opacity = "1";
        input.focus();
      }
    };

    sendBtn.onclick = handleSendMessage;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    // Focus input
    setTimeout(() => input.focus(), 100);

  } catch (error) {
    console.error("Failed to open DM:", error);
    alert("Failed to open chat. Please try again.");
  }
}

// Attach DM buttons to friend list items with debouncing
let attachTimeout;
export function attachDMButtons() {
  if (!domElements.friendsList) {
    console.warn("Friends list element not found");
    return;
  }
  
  // Debounce to prevent excessive calls
  clearTimeout(attachTimeout);
  attachTimeout = setTimeout(() => {
    const friendItems = domElements.friendsList.querySelectorAll(".friend-item");
    
    friendItems.forEach(li => {
      const uid = li.getAttribute("data-friend-uid");
      if (!uid) return;
      
      const nameSpan = li.querySelector(".friend-name");
      const name = nameSpan ? nameSpan.textContent.trim() : uid;
      
      // Only add button if not already present
      if (!li.querySelector(".dm-btn")) {
        const btn = createDMButton(uid, name);
        li.appendChild(btn);
      }
    });
  }, 100);
}

// Initialize and observe friends list for changes
function initializeDMSystem() {
  // Initial attach
  attachDMButtons();
  
  // Observe friends list for changes with better error handling
  if (domElements.friendsList) {
    const observer = new MutationObserver((mutations) => {
      let shouldAttach = false;
      
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' && 
            (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
          shouldAttach = true;
        }
      });
      
      if (shouldAttach) {
        attachDMButtons();
      }
    });
    
    observer.observe(domElements.friendsList, { 
      childList: true, 
      subtree: true 
    });
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDMSystem);
} else {
  initializeDMSystem();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  Object.keys(activeDMs).forEach(friendUid => {
    if (activeDMs[friendUid].unsubscribe) {
      activeDMs[friendUid].unsubscribe();
    }
  });
});

// Export functions for external use
export { toggleDM, closeDM, fetchProfile };