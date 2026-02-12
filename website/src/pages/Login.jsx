import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../utils/api';
import './Login.css';

function Login() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        // Check if user is already logged in
        const checkAuth = async () => {
            try {
                await auth.getCurrentUser();
                navigate('/dashboard');
            } catch (err) {
                // Not logged in, stay on login page
            }
        };
        checkAuth();
    }, [navigate]);

    const handleDiscordLogin = async () => {
        try {
            setLoading(true);
            setError('');
            const { authUrl } = await auth.getDiscordAuthUrl();
            window.location.href = authUrl;
        } catch (err) {
            setError('Failed to initiate Discord login. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <h1>🌍 AirTranslator</h1>
                    <p>Real-time Discord Translation Dashboard</p>
                </div>

                <div className="login-content">
                    <h2>Welcome!</h2>
                    <p>Sign in with Discord to manage your server translations</p>

                    {error && (
                        <div className="error-message">
                            <span>❌</span> {error}
                        </div>
                    )}

                    <button 
                        className="discord-login-btn"
                        onClick={handleDiscordLogin}
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <span className="spinner"></span>
                                Connecting...
                            </>
                        ) : (
                            <>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z"/>
                                </svg>
                                Login with Discord
                            </>
                        )}
                    </button>

                    <div className="login-footer">
                        <p>By logging in, you agree to allow AirTranslator to access your Discord servers where the bot is installed.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Login;
