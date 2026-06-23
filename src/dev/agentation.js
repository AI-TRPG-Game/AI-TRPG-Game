import React from 'react';
import { createRoot } from 'react-dom/client';
import { Agentation } from 'agentation';

const mount = document.createElement('div');
mount.id = 'agentation-root';
document.body.appendChild(mount);

createRoot(mount).render(React.createElement(Agentation));
