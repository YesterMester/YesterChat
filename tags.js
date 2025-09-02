// tags.js - Admin Feature Module for Yester Chat

import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/**
 * STATE AND CACHE
 * We keep track of the current user's admin status and cache the status of other users
 * to avoid repeatedly querying the database.
 */
let currentUserIsAdmin = false;
const adminStatusCache = {}; // Stored as { uid: boolean }

/**
 * UTILITY: CHECK ADMIN STATUS
 * Checks if a user is an admin by looking for `{ admin: 1 }` in their Firestore document.
 * @param {string} uid - The user ID to check.
 * @returns {Promise<boolean>} - True if the user is an admin, false otherwise.
 */
async function isUserAdmin(uid) {
    if (!uid) return false;
    // Return cached value if available
    if (typeof adminStatusCache[uid] === 'boolean') {
        return adminStatusCache[uid];
    }

    try {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists() && userSnap.data().admin === 1) {
            adminStatusCache[uid] = true;
            return true;
        }
    } catch (error) {
        console.error(`[Tags] Error checking admin status for ${uid}:`, error);
    }

    // Cache the negative result to prevent re-fetching
    adminStatusCache[uid] = false;
    return false;
}

/**
 * UI MODIFICATION: ADD ADMIN TAG
 * Creates and returns a styled span element for the admin tag.
 * @returns {HTMLElement} - The admin tag span element.
 */
function createAdminTag() {
    const tag = document.createElement('span');
    tag.textContent = 'Admin';
    tag.className = 'admin-tag';
    return tag;
}

/**
 * UI MODIFICATION: ADD DELETE BUTTON
 * Creates a delete button for a chat message.
 * @param {string} messageId - The Firestore document ID of the message.
 * @returns {HTMLElement} - The delete button element.
 */
function createDeleteButton(messageId) {
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.className = 'delete-message-btn';
    deleteBtn.title = 'Remove message';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        handleMessageDeletion(messageId);
    };
    return deleteBtn;
}

/**
 * ACTION: HANDLE MESSAGE DELETION
 * Prompts for a reason and performs a "soft delete" on a message in Firestore.
 * @param {string} messageId - The Firestore document ID of the message.
 */
async function handleMessageDeletion(messageId) {
    const reason = prompt("Please provide a reason for deleting this message:");

    if (reason === null) { // User clicked cancel
        return;
    }

    if (!reason.trim()) {
        alert("A reason is required to delete a message.");
        return;
    }

    if (!confirm("Are you sure you want to delete this message? This cannot be undone.")) {
        return;
    }

    try {
        const messageRef = doc(db, "servers", "defaultServer", "messages", messageId);
        await updateDoc(messageRef, {
            text: `[Message removed by admin: ${reason.trim()}]`,
            isDeleted: true,
            deletedBy: auth.currentUser.uid,
            deletedReason: reason.trim(),
            deletedAt: serverTimestamp()
        });
        console.log(`[Tags] Message ${messageId} removed by admin.`);
    } catch (error) {
        console.error(`[Tags] Failed to delete message ${messageId}:`, error);
        alert("Could not delete the message. See the console for more details.");
    }
}

/**
 * OBSERVER LOGIC: PROCESS CHAT MESSAGES
 * This function is called by the MutationObserver when a new chat message is added to the DOM.
 * @param {Node} node - The DOM node of the new chat message.
 */
async function processChatMessageNode(node) {
    // Ensure we are processing the correct element
    if (!node.matches || !node.matches('.chat-message')) return;

    const messageId = node.dataset.messageId;
    const senderNameEl = node.querySelector('.sender-name');
    const senderUid = senderNameEl ? senderNameEl.dataset.uid : null;

    if (!messageId || !senderUid) return;

    // 1. Add admin tag if sender is an admin
    if (await isUserAdmin(senderUid)) {
        if (!senderNameEl.querySelector('.admin-tag')) {
            senderNameEl.append(' ', createAdminTag());
        }
    }

    // 2. Add delete button if the current user is an admin
    if (currentUserIsAdmin) {
        const header = node.querySelector('.chat-message-header');
        if (header && !header.querySelector('.delete-message-btn')) {
            header.appendChild(createDeleteButton(messageId));
        }
    }
}

/**
 * OBSERVER LOGIC: PROCESS FRIEND LIST ITEMS
 * This function is called by the MutationObserver when a new friend item is added to the DOM.
 * @param {Node} node - The DOM node of the new friend item.
 */
async function processFriendNode(node) {
    if (!node.matches || !node.matches('.friend-item')) return;

    const friendUid = node.dataset.friendUid;
    if (!friendUid) return;

    if (await isUserAdmin(friendUid)) {
        const friendNameEl = node.querySelector('.friend-name');
        if (friendNameEl && !friendNameEl.querySelector('.admin-tag')) {
            friendNameEl.append(' ', createAdminTag());
        }
    }
}

/**
 * SETUP: CREATE ADMIN PANEL BUTTON
 * Adds the "Admin Panel" button to the top navigation bar for admin users.
 */
function setupAdminPanelButton() {
    if (document.getElementById('adminPanelBtn')) return; // Already exists

    const logoutBtn = document.getElementById('logoutBtn');
    if (!logoutBtn) return;

    const adminBtn = document.createElement('button');
    adminBtn.id = 'adminPanelBtn';
    adminBtn.textContent = 'Admin Panel';
    adminBtn.className = 'secondary'; // Or any other appropriate class
    adminBtn.onclick = () => {
        // We will build the admin panel functionality next.
        alert('Admin Panel coming soon!');
    };

    // Insert the admin button before the logout button
    logoutBtn.parentNode.insertBefore(adminBtn, logoutBtn);
}

/**
 * SETUP: INITIALIZE MUTATION OBSERVERS
 * Watches the chat and friends list for new elements to be added, then processes them.
 */
function initializeObservers() {
    const chatBox = document.getElementById('chat');
    const friendsList = document.getElementById('friendsList');

    if (chatBox) {
        const chatObserver = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => processChatMessageNode(node));
                }
            }
        });
        chatObserver.observe(chatBox, { childList: true, subtree: true });
    }

    if (friendsList) {
        const friendsObserver = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => processFriendNode(node));
                }
            }
        });
        friendsObserver.observe(friendsList, { childList: true, subtree: true });
    }
}

/**
 * SETUP: INJECT CSS STYLES
 * Adds necessary styles for the new admin UI elements to the document head.
 */
function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .admin-tag {
            background-color: #e74c3c;
            color: white;
            font-size: 0.7rem;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 4px;
            vertical-align: middle;
            margin-left: 6px;
        }
        .delete-message-btn {
            background: #f1f1f1;
            color: #999;
            border: 1px solid #ddd;
            border-radius: 50%;
            width: 22px;
            height: 22px;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            margin-left: auto; /* Pushes it to the far right */
            padding: 0;
            line-height: 20px;
            transition: all 0.2s ease;
        }
        .delete-message-btn:hover {
            background: #e74c3c;
            color: white;
            border-color: #c0392b;
        }
    `;
    document.head.appendChild(style);
}

/**
 * INITIALIZATION
 * Listens for authentication changes to set up or tear down admin features.
 */
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log('[Tags] User signed in. Checking for admin privileges...');
        currentUserIsAdmin = await isUserAdmin(user.uid);

        if (currentUserIsAdmin) {
            console.log('[Tags] Admin user detected. Setting up admin UI.');
            setupAdminPanelButton();
        }

        // Observers run for all users to see admin tags on others
        initializeObservers();
    } else {
        console.log('[Tags] User signed out. Tearing down admin UI.');
        currentUserIsAdmin = false;
        const adminBtn = document.getElementById('adminPanelBtn');
        if (adminBtn) adminBtn.remove();
    }
});

// Inject styles as soon as the script loads
injectStyles();

console.log('[Tags] Admin feature module loaded.');

