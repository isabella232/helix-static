/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
// eslint-disable-next-line import/no-extraneous-dependencies
const request = require('request-promise-native');
const postcss = require('postcss');
const log = require('@adobe/helix-log');

/**
 * Gets the santized CSS and URLs to add to the response header
 * @param {string} css the css to sanitize
 * @returns {object} css, urls
 */
async function getSanitizedCssAndUrls(cssToSanitize) {
  const foundurls = [];

  function findAndReplaceFontURLs(tree) {
    tree.walkDecls('src', (decl) => {
      // Find & push the URLs into an array for HEAD response inclusion
      const urls = decl.value.split(',').map((rule) => ({
        url: rule.replace(/.*url\(["']([^"']*)["']\).*/, '$1'),
        format: rule.replace(/.*format\(["']([^"']*)["']\).*/, '$1'),
      })).filter((rule) => rule.format === 'woff2')
        .map((rule) => rule.url)
        .map((body) => body.replace(/https:\/\/use\.typekit\.net\//g, '/hlx_fonts/'));
      foundurls.push(...urls);

      // Add swap before replacing the src
      const fontSwap = postcss.decl({ prop: 'font-display', value: 'swap' });
      decl.parent.insertAfter(decl, fontSwap);

      // Once URLs have been found and added, replace the declarations
      decl.replaceWith(postcss.decl(
        {
          prop: 'src',
          value: decl.value.replace(/https:\/\/use\.typekit\.net\//g, '/hlx_fonts/'),
        },
      ));
    });
    return tree;
  }

  function findAndRemoveExtraImport(tree) {
    tree.walkAtRules('import', (rule) => {
      if (rule.params.match(/https:\/\/p\.typekit\.net/)) {
        rule.remove();
      }
    });
  }

  const processor = postcss().use(findAndReplaceFontURLs).use(findAndRemoveExtraImport);
  const { css } = await processor.process(cssToSanitize, { from: undefined });

  return { css, foundurls };
}

async function deliverFontCSS(file) {
  const [kitid] = file.split('/').pop().split('.');

  try {
    const { body, headers } = await request(`https://use.typekit.net/${kitid}.css`, {
      resolveWithFullResponse: true,
    });

    const { css, foundurls } = await getSanitizedCssAndUrls(body);

    return {
      statusCode: 200,
      headers: {
        'cache-control': headers['cache-control'],
        'content-type': headers['content-type'],
        'surrogate-control': 'max-age=300, stale-while-revalidate=2592000',
        link: foundurls.map((url) => `<${url}>; rel=preload; as=font; crossorigin=anonymous`).join(','),
      },
      body: css,
    };
  } catch (e) {
    if (e.response) {
      return {
        statusCode: 404,
        body: e.response.body,
      };
    }
    log.error(`Error while retrieving font: ${e.message}`);
    return {
      statusCode: 502,
    };
  }
}

deliverFontCSS.getSanitizedCssAndUrls = getSanitizedCssAndUrls;

module.exports = deliverFontCSS;
