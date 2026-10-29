import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './library.css';

// StrictMode는 effect를 두 번 실행해 WebGL 엔진을 두 번 띄우므로 쓰지 않는다.
createRoot(document.getElementById('root')!).render(<App />);
