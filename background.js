// Gemini API configuration
const DEFAULT_GEMINI_API_KEY = ""; // Default key as fallback
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent";

// Initialize context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "removeRedaction",
    title: "Remove Redaction",
    contexts: ["all"]
  });

  chrome.contextMenus.create({
    id: "exportEvidence",
    title: "Export Evidence for Law Enforcement",
    contexts: ["page"]
  });

  chrome.contextMenus.create({
    id: "revealRedactedContent",
    title: "Reveal Redacted Content",
    contexts: ["all"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "removeRedaction") {
    chrome.tabs.sendMessage(tab.id, { action: "removeRedaction" });
  } else if (info.menuItemId === "exportEvidence") {
    chrome.tabs.sendMessage(tab.id, { action: "exportEvidence" });
  } else if (info.menuItemId === "revealRedactedContent") {
    chrome.tabs.sendMessage(tab.id, { action: "removeRedaction" });
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeContent") {
    console.log("Background received analyzeContent request");
    
    analyzeContentWithGemini(request.content)
      .then(analysis => {
        console.log("Analysis completed:", analysis);
        sendResponse(analysis);
      })
      .catch(error => {
        console.error("Analysis error:", error);
        sendResponse({ error: error.message });
      });
    
    return true; // Indicates async response
  } else if (request.action === "createContextMenu") {
    // Remove existing menu if it exists
    chrome.contextMenus.remove(request.id, () => {
      // Create the context menu item
      chrome.contextMenus.create({
        id: request.id,
        title: request.title,
        contexts: ["all"]
      });
    });
    sendResponse({ success: true });
    return true;
  }
});

// Function to analyze content using Gemini AI
async function analyzeContentWithGemini(content) {
  try {
    // Get the API key from storage or use default
    const storageData = await new Promise(resolve => 
      chrome.storage.sync.get('geminiApiKey', resolve)
    );
    
    // Use custom key if available, otherwise use default
    const apiKey = storageData.geminiApiKey || DEFAULT_GEMINI_API_KEY;
    
    // Log which key is being used (for debugging, don't expose the actual key)
    console.log("Using " + (storageData.geminiApiKey ? "custom" : "default") + " API key");
    
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Analyze the following web content for safety issues like cyberbullying, 
                  hate speech, threats, or other harmful content. Provide:
                  1. A safety score from 1-100 (100 being completely safe)
                  2. Identified issues with specific text segments
                  3. Reasons why these segments are concerning
                  
                  Content to analyze: ${content}`
          }]
        }]
      })
    });

    const responseData = await response.json();
    
    if (!response.ok) {
      const errorMsg = responseData.error?.message || "Failed to analyze content";
      // Check for API key related errors
      if (errorMsg.includes("API key") || response.status === 403) {
        throw new Error("Invalid API key or quota exceeded. Please check your API key in settings.");
      } else {
        throw new Error(errorMsg);
      }
    }

    return processGeminiResponse(responseData);
  } catch (error) {
    console.error("Error analyzing content:", error);
    throw error;
  }
}

// Process and structure the Gemini API response
function processGeminiResponse(apiResponse) {
  // Extract the text from the response
  const responseText = apiResponse.candidates[0]?.content?.parts[0]?.text || "";
  
  // Parse the response to extract structured information
  // This is a simple parsing example - you might need more sophisticated parsing
  const safetyScoreMatch = responseText.match(/safety score:?\s*(\d+)/i);
  const safetyScore = safetyScoreMatch ? parseInt(safetyScoreMatch[1]) : 50;
  
  // Extract identified issues
  const issues = [];
  const segments = responseText.split(/issue|concern|problem/i).slice(1);
  
  segments.forEach(segment => {
    const textMatch = segment.match(/"([^"]+)"/);
    if (textMatch) {
      issues.push({
        text: textMatch[1],
        reason: segment.split('"')[2]?.trim() || "Potentially harmful content"
      });
    }
  });
  
  return {
    safetyScore,
    issues,
    fullAnalysis: responseText
  };
}
