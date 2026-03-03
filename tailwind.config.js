/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './stations/templates/**/*.html',
        './stations/static/stations/js/**/*.js',
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Outfit', 'sans-serif'],
            },
            colors: {
                brand: {
                    light: '#38bdf8',
                    DEFAULT: '#0284c7',
                    dark: '#0e7490',
                }
            }
        },
    },
    plugins: [],
}
