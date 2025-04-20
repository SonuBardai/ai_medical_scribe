#!/bin/bash

# Exit on any error
set -e

# --- Check for pipenv ---
if ! command -v pipenv &> /dev/null; then
  echo "❌ pipenv is not installed."
  echo "➡️  Please install it using: pip install pipenv"
  exit 1
fi


# --- Start Django Backend ---
echo "🔧 Setting up Django backend..."

cd server

# Install backend dependencies if needed
if [ ! -f "Pipfile.lock" ]; then
  echo "📦 Installing Python dependencies..."
  pipenv install
else
  echo "📦 Ensuring Python dependencies are installed..."
  pipenv install --deploy --ignore-pipfile
fi

# Start Django server in background
echo "🚀 Starting Django server..."
pipenv run python manage.py runserver &

# --- Start React Frontend ---
echo "🔧 Setting up React frontend..."

cd ../client

# Install frontend dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo "📦 Installing frontend dependencies..."
  yarn install
fi

# Start React frontend
echo "🚀 Starting React frontend..."
yarn dev

echo "Visit http://localhost:5173 to view the app."
