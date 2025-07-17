import React from 'react';
import logo from './logo.svg';
import './App.css';

function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900">React GitHub Pages Template</h1>
        </div>
      </header>
      <main>
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 py-6 sm:px-0">
            <div className="rounded-lg h-96 flex flex-col items-center justify-center">
              <img src={logo} className="h-32 w-32 animate-spin" alt="logo" />
              <p className="mt-4 text-lg text-gray-700">
                Edit <code className="font-mono bg-gray-100 p-1 rounded">src/App.tsx</code> and save to reload.
              </p>
              <a
                className="mt-4 text-blue-500 hover:text-blue-700"
                href="https://reactjs.org"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn React
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
