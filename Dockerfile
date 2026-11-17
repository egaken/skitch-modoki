FROM nginx:alpine

# Cloud Run 標準ポート 8080 用の Nginx 設定をコピー
COPY nginx.conf /etc/nginx/conf.d/default.conf

# アプリケーションの静的ファイルを配置
COPY index.html /usr/share/nginx/html/index.html
COPY style.css /usr/share/nginx/html/style.css
COPY app.js /usr/share/nginx/html/app.js

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
