import React from 'react';
import { createRoot } from 'react-dom/client';
import WebcamOverlay from './Webcam';
import './style.css';

createRoot(document.getElementById('root')!).render(<WebcamOverlay />);
