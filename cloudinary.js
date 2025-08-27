// cloudinary.js
// Handles image uploads to Cloudinary and returns URL with safety checks

/**
 * Uploads a profile image to Cloudinary.
 * @param {File} file - The file object from input[type="file"]
 * @param {string} userId - The user's UID (used for public_id)
 * @param {boolean} useTimestamp - optional, true to add timestamp to public_id
 * @returns {Promise<string>} secure URL of uploaded image
 */
export async function uploadProfileImage(file, userId, useTimestamp = false) {
  if (!file) throw new Error("No file provided");

  // --- Validate file type ---
  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    throw new Error("Invalid image type. Only PNG, JPEG, or WebP allowed.");
  }

  // --- Validate file size (max 5MB) ---
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    throw new Error("Image too large. Maximum size is 5MB.");
  }

  // --- Cloudinary endpoint and unsigned preset ---
  const cloudName = "dqzvuu78t"; // replace with your Cloudinary cloud name
  const preset = "yester_profile_upload"; // replace with your unsigned preset
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/upload`;

  // --- Build public_id ---
  let publicId = `profiles/${userId}`;
  if (useTimestamp) {
    publicId += `_${Date.now()}`; // avoids overwriting previous images
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", preset);
  formData.append("public_id", publicId);
  formData.append("folder", "profiles");

  try {
    const response = await fetch(url, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cloudinary upload failed: ${text}`);
    }

    const data = await response.json();
    if (!data.secure_url) {
      throw new Error("Cloudinary response missing secure_url");
    }

    return data.secure_url;
  } catch (err) {
    console.error("Cloudinary upload error:", err);
    throw err;
  }
}
