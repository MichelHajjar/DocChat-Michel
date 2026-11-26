import { useState, useEffect } from 'react';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import Uploader from './components/Uploader';
import Chat from './components/Chat';

function App() {
  const [user, setUser] = useState(null);
  const [documentId, setDocumentId] = useState(null);

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setUser(data.user));
  }, []);

  async function logout() {
    await fetch('/api/logout', {
      method: 'POST',
      credentials: 'include'
    });
    setUser(null);
  }

  // LOGGED IN: upload + chat
  if (user) {
    return (
      <main>
        <p>Hi, {user.name}! <button onClick={logout}>Log out</button></p>
        <Uploader onUploaded={setDocumentId} />
        <Chat documentId={documentId} />
      </main>
    );
  }

  // LOGGED OUT: the forms
  return (
    <main>
      <h2>Create an account</h2>
      <RegisterForm onLoggedIn={setUser} />
      <h2>Or log in</h2>
      <LoginForm onLoggedIn={setUser} />
    </main>
  );
}

export default App;