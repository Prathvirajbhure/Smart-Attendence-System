const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const Student = require('./MODELS/Student.js');

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allows parsing larger JSON payloads if needed

// Connect to MongoDB
// Use the environment variable, but fallback to the local string if it fails
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/smart_attendance';

mongoose.connect(mongoURI)
    .then(() => console.log('MongoDB connected successfully'))
    .catch(err => console.error('MongoDB connection error:', err));

// Route 1: Register a student with their face profile
app.post('/api/register', async (req, res) => {
    try {
        const { studentId, name, faceDescriptor } = req.body;

        if (!studentId || !name || !faceDescriptor) {
            return res.status(400).json({ error: 'All fields are required.' });
        }

        const newStudent = new Student({ studentId, name, faceDescriptor });
        await newStudent.save();
        res.status(201).json({ message: 'Student registered successfully!' });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ error: 'Student ID already exists.' });
        }
        res.status(500).json({ error: error.message });
    }
});

// Route 2: Get all students (needed by the frontend to compare face profiles)
app.get('/api/students', async (req, res) => {
    try {
        const students = await Student.find({}, 'studentId name faceDescriptor');
        res.json(students);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Route 3: Mark attendance for a verified student
app.post('/api/attendance', async (req, res) => {
    try {
        const { studentId } = req.body;
        const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD

        const student = await Student.findOne({ studentId });
        if (!student) return res.status(404).json({ error: 'Student not found.' });

        // Check if attendance is already marked for today
        const alreadyMarked = student.attendance.some(record => record.date === today);
        if (alreadyMarked) {
            return res.status(400).json({ message: 'Attendance already marked for today.' });
        }

        student.attendance.push({ date: today });
        await student.save();

        res.json({ message: `Attendance marked successfully for ${student.name}!` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));