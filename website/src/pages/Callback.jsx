import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth } from '../utils/api';
import './Callback.css';

function Callback() {
    const [searchParams] = useSearchParams();
    const [error, setError] = useState('');
    const [status, setStatus] = useState('Processing...');
    const navigate = useNavigate();

    useEffect(() => {
        const handleCallback = async () => {
            try {
                const code = searchParams.get('code');
                const error = searchParams.get('error');

                if (error) {
                    setError('Authentication failed. Please try again.');
                    setTimeout(() => navigate('/'), 3000);
                    return;
                }

                if (!code) {
                    setError('Missing authorization code.');
                    setTimeout(() => navigate('/'), 3000);
                    return;
                }

                setStatus('Authenticating with Discord...');
                const result = await auth.handleCallback(code);

                if (result.success) {
                    setStatus('Login successful! Redirecting...');
                    setTimeout(() => navigate('/dashboard'), 1000);
                } else {
                    setError('Authentication failed. Please try again.');
                    setTimeout(() => navigate('/'), 3000);
                }
            } catch (err) {
                console.error('Callback error:', err);
                setError('Authentication failed. Please try again.');
                setTimeout(() => navigate('/'), 3000);
            }
        };

        handleCallback();
    }, [searchParams, navigate]);

    return (
        <div className="callback-container">
            <div className="callback-card">
                {error ? (
                    <>
                        <div className="callback-icon error">❌</div>
                        <h2>Authentication Failed</h2>
                        <p>{error}</p>
                        <p className="redirect-message">Redirecting to login...</p>
                    </>
                ) : (
                    <>
                        <div className="callback-icon">
                            <div className="spinner-large"></div>
                        </div>
                        <h2>{status}</h2>
                        <p>Please wait while we complete your authentication...</p>
                    </>
                )}
            </div>
        </div>
    );
}

export default Callback;
