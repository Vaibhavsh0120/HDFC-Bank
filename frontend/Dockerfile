FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG PUBLIC_API_URL=https://hdfc-bank.duckdns.org
ARG PUBLIC_GOOGLE_IOS_CLIENT_ID
ENV PUBLIC_API_URL=$PUBLIC_API_URL
ENV PUBLIC_GOOGLE_IOS_CLIENT_ID=$PUBLIC_GOOGLE_IOS_CLIENT_ID
RUN npm run build

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
