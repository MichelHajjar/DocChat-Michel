// ===== 1. IMPORTS (top of the file) ===== 
import express from 'express'; 
import session from 'express-session'; 
import bcrypt from 'bcrypt'; 
import { PrismaClient } from '@prisma/client'; 
import { PrismaNeonHTTP } from '@prisma/adapter-neon';
import { GoogleGenAI } from '@google/genai';
import multer from 'multer';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

// ===== 2. APP SETUP (just below the imports) ===== 
const app = express();

// Connect Prisma to Neon over HTTPS (port 443)
if (!process.env.DATABASE_URL) 
  throw new Error('DATABASE_URL not loaded — start with: node --watch --env-file=.env index.js');
const adapter = new PrismaNeonHTTP(process.env.DATABASE_URL, {});
const prisma = new PrismaClient({ adapter });
app.use(express.json());
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Keep uploaded files in memory, with a maximum size of 5 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});
// sessions: remembers who is logged in, via a signed cookie 
app.use(session({ 
  secret: process.env.SESSION_SECRET || 'dev-only-secret', 
  resave: false, 
  saveUninitialized: false, 
})); 
// Middleware: block anyone who is not logged in
function requireLogin(req, res, next) {
  if (!req.session.userId)
    return res.status(401).json({ error: 'Please log in' });

  next();
}
// ===== 3. ROUTES (all go here, ABOVE app.listen) ===== 
  
// health route — kept from Session 1 
app.get('/api/health', (req, res) => { 
  res.json({ status: 'ok', message: 'Server is alive' }); 
}); 
  
// REGISTER: create a user with a hashed password 
app.post('/api/register', async (req, res) => { 
  const { email, name, password } = req.body; 
  const hash = await bcrypt.hash(password, 10);        // 10 = work factor 
  try { 
    const user = await prisma.user.create({   //Inserts a new user into the Neon database, storing the hashed password instead of the original password.
      data: { email, name, password: hash }, 
    }); 
    req.session.userId = user.id;//Stores the user's ID in the session so the server remembers who is logged in. 
    res.json({ id: user.id, name: user.name }); //Returns the user's ID and name to the frontend, without exposing the password
    } catch (e) { 
    res.status(400).json({ error: 'Email already in use' }); 
  } 
}); 
// LOGIN: find the user, compare the password to the stored hash 
app.post('/api/login', async (req, res) => { 
  const { email, password } = req.body; //Gets the entered email and password.
  const user = await prisma.user.findUnique({ where: { email } }); //Searches for the user using their email
  if (!user) return res.status(401).json({ error: 'No such user' }); //Returns an error if the account doesn't exist.
  
  const ok = await bcrypt.compare(password, user.password); // never compare plain text. Checks the password against the stored hash. 
  if (!ok) return res.status(401).json({ error: 'Wrong password' }); //Returns an error if the password is incorrect.
  
  req.session.userId = user.id; //Logs the user in by storing their ID in the session.
  res.json({ id: user.id, name: user.name }); //Returns the user's ID and name
}); 
  
// WHO AM I: lets the front end know if someone is logged in 
app.get('/api/me', async (req, res) => { 
  if (!req.session.userId) //Checks if nobody is logged in.
   return res.json({ user: null }); //Tells the frontend that no user is logged in.
  const user = await prisma.user.findUnique({ where: { id: req.session.userId } }); //Retrieves the logged-in user from Neon using their ID.
  res.json({ user: user ? { id: user.id, name: user.name } : null }); //Returns the user's ID and name if found, otherwise null.
}); 
  
// LOGOUT 
app.post('/api/logout', (req, res) => { //Receives a logout request.
  req.session.destroy(() => res.json({ ok: true })); //Deletes the user's session, logging them out. Confirms successful logout in the course example.
}); 
// UPLOAD: receive a file, extract its text, and save it
app.post('/api/upload', requireLogin, upload.single('file'), async (req, res) => {
  try {
    let text = '';

    if (req.file.mimetype === 'application/pdf') {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text;
    } else {
      text = req.file.buffer.toString('utf-8');
    }

    const doc = await prisma.document.create({
      data: {
        title: req.file.originalname,
        content: text,
        userId: req.session.userId
      },
    });

    res.json({ id: doc.id, title: doc.title, chars: text.length });

  } catch (e) {
    res.status(400).json({
      error: 'Could not read that file. Try a text-based PDF or a .txt file.'
    });
  }
});
// CHAT: answer questions using ONLY the user's uploaded document
app.post('/api/chat', requireLogin, async (req, res) => {
  const { message, documentId } = req.body;

  try {
    // Only let users read their own documents
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.session.userId
      },
    });

    if (!doc)
      return res.status(404).json({ error: 'Upload a document first.' });

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL,
      contents: message,
      config: {
        systemInstruction:
          `You are a study assistant. Answer the student's question using ONLY ` +
          `the course material below. If the answer is not in it, reply ` +
          `"That isn't covered in this material." Never use outside knowledge.\n\n` +
          `=== COURSE MATERIAL ===\n${doc.content}`,
      },
    });

    res.json({ reply: response.text });

  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: 'DocChat is unavailable right now.'
    });
  }
});
// ===== 4. START THE SERVER (always the LAST line) ===== 
app.listen(3000, () => console.log('Server running on http://localhost:3000')); 