import React from 'react';
import { createRoot } from 'react-dom/client';
import Countdown from './Countdown';
import './style.css';

createRoot(document.getElementById('root')!).render(<Countdown />);
