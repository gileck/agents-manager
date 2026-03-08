const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const DAEMON_PORT = parseInt(process.env.AM_DAEMON_PORT || '3847', 10);
const DEV_SERVER_PORT = parseInt(process.env.WEB_DEV_PORT || '3850', 10);

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  context: path.resolve(__dirname, '..'),
  entry: './src/web/index.tsx',
  target: 'web',
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, '..', 'dist-web'),
    filename: 'bundle.[contenthash].js',
    publicPath: '/',
    clean: true,
  },
  devServer: {
    port: DEV_SERVER_PORT,
    hot: true,
    historyApiFallback: true,
    proxy: [
      {
        context: ['/api'],
        target: `http://127.0.0.1:${DAEMON_PORT}`,
      },
      {
        context: ['/ws'],
        target: `ws://127.0.0.1:${DAEMON_PORT}`,
        ws: true,
      },
    ],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-react', { runtime: 'automatic' }],
              '@babel/preset-typescript'
            ]
          }
        }
      },
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [['@babel/preset-react', { runtime: 'automatic' }]]
          }
        }
      },
      {
        test: /\.(png|jpg|gif|svg|ico)$/,
        type: 'asset/resource'
      },
      {
        test: /\.css$/,
        use: [
          'style-loader',
          'css-loader',
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                config: path.resolve(__dirname, 'postcss.config.js')
              }
            }
          }
        ]
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/web/index.html'
    })
  ],
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      '@': path.resolve(__dirname, '..', 'src/renderer'),
      '@shared': path.resolve(__dirname, '..', 'src/shared'),
      '@template': path.resolve(__dirname, '..', 'template')
    }
  }
};
