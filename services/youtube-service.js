/* eslint-disable max-len */
const { google } = require('googleapis');
const logger = require('../util/logger');

const generateSlug = require('../util/generateSlug');

// Import Event model
const { Event } = require('@wallfair.io/wallfair-commons').models;
const ytCategoryService = require('./youtube-category-service')

const ytApi = google.youtube({
  version: 'v3',
  auth: process.env.GOOGLE_API_KEY,
});

/**
 * Gets a list of videos based on the Ids given.
 * @param Array.<string> videoId
 * @returns Object
 */
const getVideosById = async (/** @type string[] */ videoIds, all = false) => {
  try {
    if (!videoIds || !videoIds.length) throw new Error('No or empty array of "videoIds" given');

    let response = await ytApi.videos.list({
      part: ['snippet,contentDetails,player,recordingDetails,statistics,status,topicDetails'],
      id: videoIds,
    });
    if(all) {
      return response?.data?.items || [];
    }
    return response?.data?.items?.[0] || undefined;
  } catch (err) {
    logger.error(err);
    return undefined;
  }
};

/**
 *
 * @param {String} streamUrl
 * @param {String} category
 * @returns
 */
const getEventFromYoutubeUrl = async (streamUrl) => {
  const videoId = streamUrl.substring(streamUrl.lastIndexOf("v=")+2);

  const streamItem = await getVideosById(videoId);
  const ytCategory = (streamItem && streamItem.snippet && !!streamItem.snippet.categoryId)
  ? await ytCategoryService.getYoutubeCategoryById(streamItem.snippet.categoryId)
  : undefined;
  const slug = generateSlug(streamItem.snippet.channelTitle);

  let event = await Event.findOne({ streamUrl }).exec();

  if (!event) {
    event = new Event({
      name: streamItem.snippet.channelTitle,
      slug,
      streamUrl,
      category : ytCategory?.snippet?.title || '',
      type: "streamed",
      previewImageUrl:
        streamItem.snippet.thumbnails?.maxres.url ||
        streamItem.snippet.thumbnails?.default.url ||
        '',
      tags: streamItem.snippet.tags.map((tag) => ({ name: tag })),
      // TODO - We're not getting the real date of when the streamed event starts from the API.
      date: new Date(),
    });
    await event.save();
    console.debug(new Date(), 'Successfully created a new youtube Event');
  } else {
    event.name = streamItem.snippet.channelTitle;
    event.previewImageUrl =
        streamItem.snippet.thumbnails?.maxres.url ||
        streamItem.snippet.thumbnails?.default.url ||
        '';
    event.tags = streamItem.snippet.tags.map((tag) => ({ name: tag }));
    await event.save();
    console.debug(new Date(), 'Successfully updated a youtube Event');
  }

  return event;
}

module.exports = {
  getEventFromYoutubeUrl,
  getVideosById
};

/**
{
  "kind": "youtube#videoListResponse",
  "etag": "zLQ0kqoxGEuGWhRPMDfz-nsCwDw",
  "items": [
    {
      "kind": "youtube#video",
      "etag": "hdH_zplS7K_BhE5UAQgMqJAAgmo",
      "id": "4sJQ8uMmti4",
      "snippet": {
        "publishedAt": "2021-09-16T09:06:05Z",
        "channelId": "UCZkcxFIsqW5htimoUQKA0iA",
        "title": "🎙 Pressetalk mit Leon Goretzka, Oliver Kahn und Hasan Salihamidzic zur Vertragsverlängerung",
        "description": "Leon Goretzka hat ein neues Arbeitspapier beim FC Bayern unterschrieben und bis 2026 verlängert. Schau dir jetzt den Pressetalk dazu live an und höre dir an, was Goretzka, Kahn und Salihamidzic dazu sagen.\n\n► #MiaSanMia - Abonnieren & die Glocke aktivieren 🔔: https://fc.bayern/YouTubeAbo\n\nFacebook: https://www.facebook.com/FCBayern\nTwitter: https://twitter.com/fcbayern\nInstagram: https://www.instagram.com/fcbayern\nTikTok: https://www.tiktok.com/@fcbayern\nSnapchat: https://fc.bayern/FCBayernSnaps\nWebsite: https://fcbayern.com\nFC Bayern.tv: https://fcbayern.com/fcbayerntv\nFC Bayern.tv live: https://fcbayern.com/fcbayerntv/de/fcbayerntvlive",
        "thumbnails": {
          "default": {
            "url": "https://i.ytimg.com/vi/4sJQ8uMmti4/default_live.jpg",
            "width": 120,
            "height": 90
          },
          "medium": {
            "url": "https://i.ytimg.com/vi/4sJQ8uMmti4/mqdefault_live.jpg",
            "width": 320,
            "height": 180
          },
          "high": {
            "url": "https://i.ytimg.com/vi/4sJQ8uMmti4/hqdefault_live.jpg",
            "width": 480,
            "height": 360
          },
          "standard": {
            "url": "https://i.ytimg.com/vi/4sJQ8uMmti4/sddefault_live.jpg",
            "width": 640,
            "height": 480
          },
          "maxres": {
            "url": "https://i.ytimg.com/vi/4sJQ8uMmti4/maxresdefault_live.jpg",
            "width": 1280,
            "height": 720
          }
        },
        "channelTitle": "FC Bayern München",
        "tags": [
          "FC Bayern München",
          "Bayern Munich",
          "FCB",
          "FC Bayern",
          "Fußball",
          "Football",
          "Soccer",
          "Pressetalk",
          "Pressekonferenz",
          "Hasan Salihamidzic",
          "Salihamidzic",
          "Oliver Kahn",
          "Kahn",
          "Leon Goretzka",
          "Goretzka",
          "Goretzka 2026",
          "Vertrag",
          "Vertragsverlängerung",
          "2026",
          "LG2026"
        ],
        "categoryId": "17",
        "liveBroadcastContent": "upcoming",
        "defaultLanguage": "en",
        "localized": {
          "title": "🎙 Pressetalk mit Leon Goretzka, Oliver Kahn und Hasan Salihamidzic zur Vertragsverlängerung",
          "description": "Leon Goretzka hat ein neues Arbeitspapier beim FC Bayern unterschrieben und bis 2026 verlängert. Schau dir jetzt den Pressetalk dazu live an und höre dir an, was Goretzka, Kahn und Salihamidzic dazu sagen.\n\n► #MiaSanMia - Abonnieren & die Glocke aktivieren 🔔: https://fc.bayern/YouTubeAbo\n\nFacebook: https://www.facebook.com/FCBayern\nTwitter: https://twitter.com/fcbayern\nInstagram: https://www.instagram.com/fcbayern\nTikTok: https://www.tiktok.com/@fcbayern\nSnapchat: https://fc.bayern/FCBayernSnaps\nWebsite: https://fcbayern.com\nFC Bayern.tv: https://fcbayern.com/fcbayerntv\nFC Bayern.tv live: https://fcbayern.com/fcbayerntv/de/fcbayerntvlive"
        },
        "defaultAudioLanguage": "de"
      },
      "contentDetails": {
        "duration": "P0D",
        "dimension": "2d",
        "definition": "sd",
        "caption": "false",
        "licensedContent": true,
        "contentRating": {},
        "projection": "rectangular"
      },
      "status": {
        "uploadStatus": "uploaded",
        "privacyStatus": "public",
        "license": "youtube",
        "embeddable": true,
        "publicStatsViewable": true,
        "madeForKids": false
      },
      "statistics": {
        "viewCount": "0",
        "likeCount": "49",
        "dislikeCount": "1",
        "favoriteCount": "0",
        "commentCount": "0"
      },
      "player": {
        "embedHtml": "\u003ciframe width=\"480\" height=\"360\" src=\"//www.youtube.com/embed/4sJQ8uMmti4\" frameborder=\"0\" allow=\"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture\" allowfullscreen\u003e\u003c/iframe\u003e"
      },
      "recordingDetails": {}
    }
  ],
  "pageInfo": {
    "totalResults": 1,
    "resultsPerPage": 1
  }
}
*/
