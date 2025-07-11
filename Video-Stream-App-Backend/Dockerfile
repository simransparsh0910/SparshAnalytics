# Use Node.js image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose port
EXPOSE 8080
EXPOSE 9000
EXPOSE 5000
EXPOSE 5010
EXPOSE 5020

# Start the server
CMD ["node", "server.js"]
