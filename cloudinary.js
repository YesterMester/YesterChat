// cloudinary.js
// Handles image uploads to Cloudinary and returns URL

export async function uploadProfileImage(file, userId) {
  if (!file) throw new Error("No file provided");

  const url = `https://api.cloudinary.com/v1_1/dqzvuu78t/upload`; // replace YOUR_CLOUD_NAME
  const preset = "yester_profile_upload"; // replace with your unsigned preset

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", preset);
  formData.append("public_id", `profiles/${userId}`); // organize images by userId
  formData.append("folder", "profiles"); // optional folder

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
    return data.secure_url; // return the URL to store in Firestore
  } catch (err) {
    console.error("Cloudinary upload error:", err);
    throw err;
  }
}