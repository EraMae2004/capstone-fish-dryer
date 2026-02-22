import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        laravel({
            input: [
                'resources/css/app.css',
                'resources/css/Authentication/signin.css',
                'resources/css/Authentication/forgot-password.css',
                'resources/css/Authentication/reset-password.css',
                'resources/js/app.js',
                'resources/js/welcome.js',
                'resources/js/signin.js',
                'resources/js/reset-password.js',
            ],
            refresh: true,
        }),
        tailwindcss(),
    ],

    server: {
        host: '0.0.0.0',
        hmr: {
            host: 'localhost',
        },
        watch: {
            usePolling: true,
        },
    },
});