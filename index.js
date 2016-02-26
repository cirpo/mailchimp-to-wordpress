var request = require('request');
var cheerio = require('cheerio');
var _ = require('underscore');

var config = require('./config.js');

var wpAppUser = config.wpAppUser;
var wpAppPass = config.wpAppPass;

var issuesURL = [];
var postsIssueURL = [];

var mailchimpOpts = {
    url: config.mailchimpArchiveUrl + '&show=' + config.mailchimpArchiveShow
};
var wordpressOpts = {
    url: config.wpApiUrl + '/posts',
    // headers: {
    //     'Authorization': 'Basic ' + Buffer(wpAppUser + ':' + wpAppPass).toString('base64')
    // },
    json: true
};

request.get(mailchimpOpts, function (error, response, jscode) {
    console.log('getting list of issues from Mailchimp');
    if (!error && response.statusCode == 200) {

        var htmlcode = '<html><body>' + eval(jscode.replace(/^document.write\(/,'').replace(/\);$/,'')) + '</body></html>';
        var $ = cheerio.load(htmlcode);
        $('.campaign a').each(function(i,elem){
            issuesURL.push($(elem).attr('href'));
        });

        console.log('you have ' + issuesURL.length + ' issues in Mailchimp\'s archive');

        request(wordpressOpts, function (error, response, posts) {
            console.log('getting list of posts from Wordpress');
            if (!error && response.statusCode == 200) {

                // get already saved issues/posts using the 'mailchimp_url' meta as identifier
                posts.forEach(function(post){
                    postsIssueURL.push(post.mailchimp_url[0]);
                });

                console.log('you have ' + postsIssueURL.length + ' issues in Wordpress');

                // get the issues that have not yet been saved
                var issuesMissing = _.difference(issuesURL, postsIssueURL);

                console.log('going to add ' + issuesMissing.length + ' issues to Wordpress');

                // debug: trim the array
                issuesMissing.length = 1;

                issuesMissing.forEach(function(issueURL){
                    console.log('retrieving missing issue content from ' + issueURL);
                    request.get({url:issueURL,normalizeWhitespace:true}, function (error, response, htmlcode) {
                        if (!error && response.statusCode == 200) {
                            var $ = cheerio.load(htmlcode);
                            // store the issue date
                            var issueDate = $('#templateHeader h5').text().replace(/^Issue: /,'');
                            // store the issue categories
                            var issueTags = [];
                            $('#templateColumns h5').each(function(i, el) { // this is a Cheerio each!
                                var tag = $(el).text().trim();
                                if(tag) {
                                    issueTags.push(tag);
                                }
                            });
                            // remove the header, footer and other strange things
                            $('#templatePreheader').remove();
                            $('#templateHeader').remove();
                            $('#templateFooter').remove();
                            $('#awesomewrap').remove();
                            // cleanup all inline styles, decoration attributes, etc.
                            $('[style]').removeAttr('style');
                            $('[width]').removeAttr('width');
                            $('[height]').removeAttr('height');
                            $('[align]').removeAttr('align');
                            $('[valign]').removeAttr('valign');
                            $('[cellspacing]').removeAttr('cellspacing');
                            $('[cellpadding]').removeAttr('cellpadding');
                            $('[border]').removeAttr('border');
                            // get the residual HTML chunk
                            htmlchunk = '<table id="#templateContainer">' + $('body #templateContainer').html() + '</table>';
                            // strip invisible spacing characters (e.g. &#xA0;)
                            htmlchunk = htmlchunk.replace(/&#xA0;/g,' ');
                            console.log(issueDate, issueTags, htmlchunk);
                        }
                    });
                });

            }
        });

    }
});