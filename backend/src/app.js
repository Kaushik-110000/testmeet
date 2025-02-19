import axios from "axios";

async function getPublicIP() {
  try {
    const response = await axios.get("https://api64.ipify.org?format=json");
    console.log("Public IP:", response.data.ip);
  } catch (error) {
    console.error("Error fetching public IP:", error);
  }
}

getPublicIP();
