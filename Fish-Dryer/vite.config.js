import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        laravel({
            input: [

                // USER CSS & JS               
                'resources/css/app.css',
                'resources/css/Authentication/signin.css',
                'resources/css/Authentication/reset-password.css',
                'resources/css/Authentication/forgot-password.css',
                'resources/css/user-view/user-view.css',
                'resources/css/user-view/user-profile.css',
                'resources/css/user-view/user-overview.css',
                'resources/css/user-view/user-notifications.css',
                'resources/css/user-view/user-history.css',
                'resources/css/user-view/user-hardware.css',
                'resources/css/user-view/user-change-password.css',

                'resources/js/app.js',
                'resources/js/welcome.js',
                'resources/js/signin.js',
                'resources/js/reset-password.js',
                'resources/js/user-change-password.js',
                'resources/js/user-overview.js',




                // ADMIN CSS & JS
                'resources/css/admin-view/admin-view.css',
                'resources/css/admin-view/admin-Overview.css',
                'resources/css/admin-view/admin-profile.css',
                'resources/css/admin-view/user-management.css',
                'resources/css/admin-view/user-management-edit.css',
                'resources/css/admin-view/admin-change-password.css',

                'resources/js/add-machine.js',
                'resources/js/admin-change-password.js',
                'resources/js/admin-delete-user.js',
                'resources/js/admin-profile.js',
                'resources/js/user-management-edit.js',



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