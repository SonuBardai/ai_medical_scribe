import { useNavigate } from "react-router-dom";
import { PROJECT_NAME, BACKEND_URL } from "../constants";
import { useEffect, useState } from "react";
import axios from "axios";

const NavBar = () => {
  const navigate = useNavigate();
  const [backendConnected, setBackendConnected] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const fn = async () => {
      try {
        const response = await axios.get(`${BACKEND_URL}/rest/health/live`);
        setBackendConnected(response.data);
      } catch (error) {
        console.error("Error checking backend connection:", error);
        setError(true);
      }
    };
    fn();
  }, []);

  return (
    <div className="navbar bg-base-100">
      <div className="flex-1">
        <a className="btn btn-ghost text-xl" onClick={() => navigate("/")}>
          {PROJECT_NAME}
        </a>
      </div>

      {backendConnected && <div className="mr-4">✅ API Running</div>}
      {error && <div className="mr-4">❌ API Not Running</div>}

      <div className="flex-none">
        <button className="btn btn-outline btn-ghost" onClick={() => navigate("/login")}>
          Login
        </button>
      </div>
    </div>
  );
};

export default NavBar;
